using System.Text.Json;
using System.Text.Json.Nodes;

internal static class PositionCoverageTests
{
    internal static async Task Run(string repository,JsonSerializerOptions options,string envelopePath)
    {
        var original=await File.ReadAllBytesAsync(Path.Combine(repository,".sim-state/data/rfq-intakes.json"));
        var node=JsonNode.Parse(await File.ReadAllTextAsync(envelopePath))!["record"]!.DeepClone();
        node["status"]="TECHNICAL_REVIEW_IN_PROGRESS";node["technicalReview"]!["workflow"]=null;node["technicalReview"]!["bomAcceptances"]=new JsonArray();
        var record=node.Deserialize<SimRfqIntakeRecord>(options)!;var initial=record.TechnicalReview!.CandidateBom!;
        var rows=initial.Rows.ToList();
        record=record with {TechnicalReview=record.TechnicalReview with {CandidateBom=initial with {Rows=rows.ToArray()}}};
        var root=Path.Combine(Path.GetTempPath(),"dle-dnp-"+Guid.NewGuid().ToString("N"));Directory.CreateDirectory(Path.Combine(root,"data"));
        var docs=Path.Combine(root,"intake-documents",record.RequestCorrelationId);Directory.CreateDirectory(docs);
        foreach(var f in record.TechnicalFiles.Where(f=>f.DocumentId is not null))foreach(var ext in new[]{".bin",".json"})File.Copy(Path.Combine(repository,".sim-state/intake-documents",record.RequestCorrelationId,f.DocumentId+ext),Path.Combine(docs,f.DocumentId+ext));
        var dataPath=Path.Combine(root,"data/rfq-intakes.json");await File.WriteAllTextAsync(dataPath,JsonSerializer.Serialize(new{schema="DLE_RFQ_INTAKE_DATASET_V1",records=new[]{record}},options));
        await File.WriteAllTextAsync(Path.Combine(root,"before.json"),JsonSerializer.Serialize(record,options));
        var store=new SimRfqIntakeStore(root);var persona=new SimPersona("test","test","DNP Reviewer","ACTIVE",[],[],true,"SIM");
        void Check(bool ok,string text){if(!ok)throw new Exception(text);Console.WriteLine("PASS: "+text);}
        async Task<SimRfqIntakeRecord> Read()=>JsonSerializer.SerializeToElement(await new SimRfqIntakeStore(root).ReadTechnicalReviewAsync(record.IntakeId),options).GetProperty("record").Deserialize<SimRfqIntakeRecord>(options)!;
        async Task<SimCandidateBom> Bom()=>(await Read()).TechnicalReview!.CandidateBom!;
        Dictionary<string,string> Values(SimCandidateRow r)=>SimCandidateBomProvider.Fields.ToDictionary(k=>k,k=>r.Values[k]);
        async Task Accept(int index){var b=await Bom();var r=b.Rows[index];await store.CandidateBomAsync(record.IntakeId,persona,new(b.Id,index,Values(r),WorksheetAcceptance:new(r.ReviewState.Token,r.ComponentType,r.AssemblyIdentity?.PartNumber)));}
        foreach(int index in rows.Where(r=>r.Values["lineNumber"] is "6" or "7").Select(r=>r.Index)){
            var b=await Bom();var r=b.Rows[index];var source=JsonSerializer.Serialize(r.Extracted,options);
            await store.CandidateBomAsync(record.IntakeId,persona,new(b.Id,-1,null,ProgressRows:[new(index,r.ReviewState.Token,Values(r),"DNP")]));
            r=(await Bom()).Rows[index];Check(!r.ReviewState.Reviewed&&r.Values["description"]=="DO NOT POPULATE","Find "+r.Values["lineNumber"]+" Save Progress normalizes description but requires Accept");
            await Accept(index);r=(await Bom()).Rows[index];
            Check(r.ReviewState.Reviewed&&r.ComponentType=="DNP"&&r.Values["designators"]==rows[index].Values["designators"],"Find "+r.Values["lineNumber"]+" / "+r.Values["designators"]+" accepts and reopens");
            Check(r.Values["partNumber"]==""&&r.PrimaryIdentity is null&&r.ManufacturerIdentity!.Proposals.Length==0&&JsonSerializer.Serialize(r.Extracted,options)==source,"DNP needs no identity and preserves NOT USED evidence");
            b=await Bom();await store.CandidateBomAsync(record.IntakeId,persona,new(b.Id,index,null,ComponentChange:new("STANDARD_COTS",r.ComponentTypeRevision)));
            r=(await Bom()).Rows[index];Check(!r.ReviewState.Reviewed,"leaving DNP returns Needs Review");
            try{await Accept(index);throw new Exception("normal empty identity accepted");}catch(SimRfqIntakeProblem){Check(!(await Bom()).Rows[index].ReviewState.Reviewed,"normal type restores P/N and quantity requirements");}
            b=await Bom();var v=Values(r);v["quantity"]="1";await store.CandidateBomAsync(record.IntakeId,persona,new(b.Id,index,v,WorksheetAcceptance:new(r.ReviewState.Token,"DNP")));
            Check((await Bom()).Rows[index].ReviewState.Reviewed,"direct DNP selection and explicit Accept succeeds");
        }
        var current=await Bom();var m=current.Rows.First(r=>r.ComponentType=="STANDARD_COTS"&&r.ManufacturerIdentity?.Proposals.Length>0);var identities=JsonSerializer.Serialize(m.ManufacturerIdentity,options);
        await store.CandidateBomAsync(record.IntakeId,persona,new(current.Id,m.Index,null,ComponentChange:new("DNP",m.ComponentTypeRevision)));
        Check(!(await Bom()).Rows[m.Index].ReviewState.Reviewed,"accepted populated row changed to DNP needs re-Accept");await Accept(m.Index);
        Check(JsonSerializer.Serialize((await Bom()).Rows[m.Index].ManufacturerIdentity,options)==identities,"DNP acceptance neither deletes nor confirms manufacturer evidence");
        m=(await Bom()).Rows[m.Index];await store.CandidateBomAsync(record.IntakeId,persona,new(current.Id,m.Index,null,ComponentChange:new("STANDARD_COTS",m.ComponentTypeRevision)));await Accept(m.Index);
        Check(initial.Rows.Length==105 && initial.ReviewedScanSource!.Worksheet.Rows.Length==106,"105 obligations plus one source-only continuation cover 106 positions");
        Check(initial.Rows.Count(r=>r.SourcePositionKind=="BLANK")==6 && initial.Rows.Count(r=>r.SourcePositionKind=="NOT_USED")==14,"blank and NOT USED positions retained without technical acceptance");
        // Resolve only the disposable fixture to exercise the real complete-BOM snapshot.
        for(int i=0;i<rows.Count;i++){var b=await Bom();var r=b.Rows[i];if(r.ReviewState.Reviewed)continue;var v=Values(r);var type=r.SourcePositionKind is "BLANK" or "NOT_USED" || (r.SourcePositionKind=="OTHER"&&r.Values["lineNumber"]!="85")?"DNP":r.ComponentType;if(type!="DNP"&&string.IsNullOrWhiteSpace(v["partNumber"]))v["partNumber"]="TEST-PART-"+i;if(!int.TryParse(v["lineNumber"],out var n)||n<1)v["lineNumber"]=(i+1).ToString();if(!decimal.TryParse(v["quantity"],out var q)||q<=0)v["quantity"]="1";var manual=r.IdentityBasis=="CUSTOMER_PN"||r.ManufacturerIdentity?.Proposals.Any(p=>!string.IsNullOrWhiteSpace(p.PartNumber))==true?null:"TEST-PART-"+i;await store.CandidateBomAsync(record.IntakeId,persona,new(b.Id,i,v,WorksheetAcceptance:new(r.ReviewState.Token,type,r.AssemblyIdentity?.PartNumber??"TEST-ASSEMBLY",ManualPartNumber:manual)));}
        var customer=(await Bom()).Rows.FirstOrDefault(r=>r.IdentityBasis=="CUSTOMER_PN");
        if(customer is not null){await Accept(customer.Index);Check((await Bom()).Rows[customer.Index].ReviewState.Reviewed,"Customer P/N path remains valid");}
        var textRecord=JsonNode.Parse(original)!["records"]!.AsArray().Single(n=>(string?)n!["intakeId"]=="RFQI-SIM-0035")!.Deserialize<SimRfqIntakeRecord>(options)!;
        var textBom=textRecord.TechnicalReview!.CandidateBom!;var sub=textBom.Rows.First(r=>r.ComponentType=="SUBASSEMBLY");
        var assembly=sub.AssemblyIdentity?.PartNumber??sub.Alternates!.First(a=>a.Origin=="MANUAL"&&a.ReviewStatus=="CONFIRMED").PartNumber;
        var subResult=SimCandidateBomProvider.Review(textBom,new(textBom.Id,sub.Index,Values(sub),WorksheetAcceptance:new(sub.ReviewState.Token,"SUBASSEMBLY",assembly)),persona);
        Check(subResult.Rows[sub.Index].ReviewState.Reviewed&&subResult.Rows[sub.Index].IdentityBasis=="ASSEMBLY_PN","B11283-17 Subassembly regression");
        var normal=textBom.Rows.First(r=>r.ComponentType=="STANDARD_COTS"&&r.ManufacturerIdentity?.Proposals.Length>1);
        var normalResult=SimCandidateBomProvider.Review(textBom,new(textBom.Id,normal.Index,Values(normal),WorksheetAcceptance:new(normal.ReviewState.Token,normal.ComponentType)),persona);
        Check(normalResult.Rows[normal.Index].ReviewState.Reviewed&&normalResult.Rows[normal.Index].ManufacturerIdentity!.Proposals.Length==normal.ManufacturerIdentity!.Proposals.Length,"B11283-17 multiple manufacturer regression");
        var ready=await Bom();
        var blank=ready.Rows.First(r=>r.SourcePositionKind=="BLANK");
        await store.CandidateBomAsync(record.IntakeId,persona,new(ready.Id,blank.Index,null,ComponentChange:new("STANDARD_COTS",blank.ComponentTypeRevision)));
        var blocked=await Bom();var readiness=JsonSerializer.SerializeToElement(await store.BomCompletionReadiness(record.IntakeId,new(blocked)),options);
        Check(!readiness.GetProperty("ready").GetBoolean(),"hidden unresolved source position blocks completion");
        var unresolved=blocked.Rows[blank.Index];await store.CandidateBomAsync(record.IntakeId,persona,new(blocked.Id,blank.Index,Values(unresolved),WorksheetAcceptance:new(unresolved.ReviewState.Token,"DNP")));
        ready=await Bom();await store.CompleteBomReview(record.IntakeId,new(ready),persona);var accepted=(await Read()).TechnicalReview!.BomAcceptances!.Last().Candidate;
        Check(accepted.Rows.Where(r=>r.Values["lineNumber"] is "6" or "7").All(r=>r.ComponentType=="DNP"&&r.Values["description"]=="DO NOT POPULATE"&&r.Values["designators"].StartsWith("Q")),"Accepted BOM preserves both DNP instructions and Ref Des");
        await File.WriteAllTextAsync(Path.Combine(root,"accepted.json"),JsonSerializer.Serialize(await Read(),options));
        Check(original.SequenceEqual(await File.ReadAllBytesAsync(Path.Combine(repository,".sim-state/data/rfq-intakes.json"))),"active SIM data unchanged");
        Console.WriteLine("DNP_FIXTURE="+root);
    }
}
