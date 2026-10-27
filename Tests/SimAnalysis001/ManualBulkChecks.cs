using System.Security.Cryptography;
using System.Text.Json;
using System.Text.Json.Nodes;

internal static class ManualBulkChecks
{
    internal static async Task Run(string sourceRoot,string root)
    {
        if(Directory.Exists(root))throw new Exception("Use a new isolated fixture directory.");
        var json=DleAnalysisContract.Json;
        var sourcePath=Path.Combine(sourceRoot,"data","rfq-intakes.json");
        var live=await File.ReadAllBytesAsync(sourcePath);
        var data=JsonNode.Parse(live)!;
        var record=data["records"]!.AsArray().Single(r=>r!["intakeId"]!.GetValue<string>()=="RFQI-SIM-0047")!.DeepClone();
        var path=Path.Combine(root,"data","rfq-intakes.json");Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        data["records"]=new JsonArray(record);await File.WriteAllTextAsync(path,data.ToJsonString());
        var correlation=record["requestCorrelationId"]!.GetValue<string>();var files=Path.Combine(root,"intake-documents",correlation);Directory.CreateDirectory(files);
        var hashes=new Dictionary<string,string>();
        foreach(var doc in record["technicalFiles"]!.AsArray())foreach(var ext in new[]{".bin",".json"})
        {
            var name=doc!["documentId"]!.GetValue<string>()+ext;
            var sourceBytes=await File.ReadAllBytesAsync(Path.Combine(sourceRoot,"intake-documents",correlation,name));
            hashes[name]=Convert.ToHexString(SHA256.HashData(sourceBytes));await File.WriteAllBytesAsync(Path.Combine(files,name),sourceBytes);
        }
        var store=new SimRfqIntakeStore(root);var actor=new SimPersona("fixture","fixture","Bulk BOM reviewer","ACTIVE",[],[],true,"test");
        JsonNode Node(object value)=>JsonSerializer.SerializeToNode(value,json)!;
        string Serialize(object? value)=>JsonSerializer.Serialize(value,json);
        async Task<JsonNode> Read()=>Node(await new SimRfqIntakeStore(root).CandidateBomAsync("RFQI-SIM-0047",actor));
        SimCandidateBom Bom(JsonNode value)=>value["record"]!["technicalReview"]!["candidateBom"]!.Deserialize<SimCandidateBom>(json)!;
        void Check(bool good,string message){if(!good)throw new Exception(message);Console.WriteLine("PASS: "+message);}
        SimCandidateReviewRequest Request(SimCandidateBom bom,string action,IEnumerable<SimCandidateRow> rows)=>new(bom.Id,-1,null,BulkReview:new(action,rows.Select(r=>new SimCandidateBulkRow(r.RowId!,r.ReviewState.Token)).ToArray()));
        async Task<JsonNode> Apply(SimCandidateReviewRequest request)=>Node(await store.CandidateBomAsync("RFQI-SIM-0047",actor,request));
        async Task Reject(SimCandidateReviewRequest request,string code,string name)
        {
            var before=await File.ReadAllBytesAsync(path);
            try{await Apply(request);throw new Exception("Expected rejection: "+name);}catch(SimRfqIntakeProblem e) when(e.Code==code){}
            Check(before.SequenceEqual(await File.ReadAllBytesAsync(path)),name+" rejects without writing");
        }
        var view=await Read();var initial=Bom(view);var initialRecord=view["record"]!.DeepClone();
        Check(initial.Rows.Length==6&&initial.Rows[0].PrimaryIdentity?.Basis=="CUSTOMER_PN"&&initial.Rows[0].ReviewState.Reviewed&&initial.Rows[1].PrimaryIdentity?.Basis=="CUSTOMER_PN","copied fixture contains accepted customer row 1 and customer row 2");
        view=await Apply(Request(initial,"USE_ENTERED_MPN",initial.Rows.Take(5)));
        var classified=Bom(view);var result=view["bulkResult"]!.Deserialize<SimCandidateBulkResult>(json)!;
        Check(result.ChangedCount==5&&result.Results.All(r=>r.Status=="UPDATED")&&classified.ManualDraft!.Revision==initial.ManualDraft!.Revision+1,"one bulk classification updates selected rows in one manual revision");
        Check(classified.Rows.Take(5).All(r=>r.IdentityBasis=="MANUFACTURER_PN"&&!r.Confirmed&&!r.ReviewState.Reviewed),"explicit classification changes customer identities but does not accept rows");
        Check(Serialize(classified.Rows[0].WholeRowHistory)==Serialize(initial.Rows[0].WholeRowHistory)&&classified.Rows[0].SourcePartNumberReview!.Current.PreviousPrimaryIdentity==initial.Rows[0].PrimaryIdentity&&classified.Rows[1].SourcePartNumberReview!.Current.PreviousPrimaryIdentity==initial.Rows[1].PrimaryIdentity,"prior acceptance and customer identity reviewer histories retained");
        Check(Serialize(classified.Rows[5])==Serialize(initial.Rows[5])&&classified.Rows.Zip(initial.Rows).All(pair=>Serialize(pair.First.Values)==Serialize(pair.Second.Values))&&classified.Rows.Zip(initial.Rows).All(pair=>Serialize(pair.First.Corrections)==Serialize(pair.Second.Corrections)),"unselected row 6, every entered field and existing correction history stay unchanged");
        Check(classified.Rows.Take(5).All(r=>r.SourcePartNumberReview!.Current.Origin=="DLE_AUTHORED_REVIEWER_DECLARATION"&&r.ManufacturerIdentity!.Proposals.All(p=>p.SourceLabel.Contains("DLE-authored")&&p.Evidence.DocumentId==""&&p.Evidence.Page is null&&p.Confidence=="HUMAN_REVIEWED"&&p.Uncertainty.Contains("no document extraction, catalog or manufacturer-name verification"))),"manual identity evidence accurately records reviewer declaration without source or catalog verification");
        Check(classified.Rows.Skip(1).Take(4).Zip(initial.Rows.Skip(1).Take(4)).All(pair=>Serialize(pair.First.WorkingState)==Serialize(pair.Second.WorkingState)),"classification retains saved working changes pending row Accept");
        var bytes=await File.ReadAllBytesAsync(path);view=await Apply(Request(classified,"USE_ENTERED_MPN",classified.Rows.Take(5)));
        Check(view["bulkResult"]!["changedCount"]!.GetValue<int>()==0&&view["bulkResult"]!["results"]!.AsArray().All(r=>r!["status"]!.GetValue<string>()=="ALREADY")&&bytes.SequenceEqual(await File.ReadAllBytesAsync(path)),"repeat classification is ALREADY with no data write");
        view=await Apply(Request(Bom(view),"ACCEPT_SELECTED",Bom(view).Rows));
        var accepted=Bom(view);result=view["bulkResult"]!.Deserialize<SimCandidateBulkResult>(json)!;
        Check(result.ChangedCount==5&&result.Results.Take(5).All(r=>r.Status=="ACCEPTED")&&result.Results[5].Status=="BLOCKED"&&result.Results[5].Message.Contains("Confirm a Manufacturer P/N"),"bulk Accept accepts reviewed identities and reports missing identity without blanket confirmation");
        Check(accepted.Rows.Take(5).All(r=>r.ReviewState.Reviewed&&r.WorkingState is null)&&accepted.ManualDraft!.Revision==classified.ManualDraft!.Revision+1,"worksheet acceptance clears working markers and advances only one manual revision");
        Check(accepted.Rows[0].WholeRowHistory!.Length==initial.Rows[0].WholeRowHistory!.Length+1&&accepted.Rows[0].WholeRowHistory!.Take(initial.Rows[0].WholeRowHistory!.Length).SequenceEqual(initial.Rows[0].WholeRowHistory!),"acceptance appends existing row 1 acceptance history");
        var compared=view["record"]!.DeepClone();compared["technicalReview"]!["candidateBom"]=initialRecord["technicalReview"]!["candidateBom"]!.DeepClone();
        Check(JsonNode.DeepEquals(compared,initialRecord)&&Serialize(accepted.Rows[5])==Serialize(initial.Rows[5]),"attachments, presentation, qualification, workflow and unselected row remain unchanged");
        bytes=await File.ReadAllBytesAsync(path);view=await Apply(Request(accepted,"ACCEPT_SELECTED",accepted.Rows));
        Check(view["bulkResult"]!["changedCount"]!.GetValue<int>()==0&&bytes.SequenceEqual(await File.ReadAllBytesAsync(path)),"already accepted plus blocked batch performs no write");
        bytes=await File.ReadAllBytesAsync(path);view=await Apply(Request(accepted,"USE_ENTERED_MPN",accepted.Rows.Take(5)));
        Check(Bom(view).Rows.Take(5).All(r=>r.ReviewState.Reviewed)&&bytes.SequenceEqual(await File.ReadAllBytesAsync(path)),"repeat MPN action does not reset accepted matching rows");
        var stale=Request(accepted,"ACCEPT_SELECTED",accepted.Rows.Take(1));stale=stale with{BulkReview=stale.BulkReview! with{Rows=[new(accepted.Rows[0].RowId!,"stale"),new(Guid.NewGuid().ToString("D"),"stale")]}};
        bytes=await File.ReadAllBytesAsync(path);view=await Apply(stale);result=view["bulkResult"]!.Deserialize<SimCandidateBulkResult>(json)!;
        Check(result.Results.Select(r=>r.Code).SequenceEqual(new[]{"SIM_ROW_APPROVAL_STALE","SIM_ROW_NOT_FOUND"})&&bytes.SequenceEqual(await File.ReadAllBytesAsync(path)),"stale row token and foreign stable row ID produce blocked results without writes");
        await Reject(Request(accepted,"ACCEPT_SELECTED",accepted.Rows.Take(1)) with{CandidateId="stale-candidate"},"SIM_CANDIDATE_STALE","stale candidate ID");
        var duplicate=Request(accepted,"ACCEPT_SELECTED",[accepted.Rows[0],accepted.Rows[0]]);
        await Reject(duplicate,"SIM_BULK_INVALID","duplicate selected rows");
        await Reject(Request(accepted,"ACCEPT_SELECTED",accepted.Rows.Take(1)) with{Values=new(accepted.Rows[0].Values)},"SIM_BULK_INVALID","mixed edit and batch action");
        var seed=accepted.Rows[5];var proposal=accepted.Rows[0].ManufacturerIdentity!.Proposals[0] with{Id="fixture-pending",PartNumber=seed.Values["partNumber"]};
        void Blocked(SimCandidateRow row,string action,string name)
        {
            var rows=accepted.Rows.ToArray();rows[5]=row;var bom=accepted with{Rows=rows};var before=Serialize(bom);
            var outcome=SimCandidateBomProvider.ReviewBulk(bom,Request(bom,action,[row]),actor);
            Check(outcome.Result.ChangedCount==0&&outcome.Result.Results.Single().Status=="BLOCKED"&&Serialize(outcome.Bom)==before&&Serialize(bom)==before,name+" stays unchanged");
        }
        Blocked(seed with{ComponentType="UNKNOWN"},"ACCEPT_SELECTED","unknown component type");
        Blocked(seed with{Values=new(seed.Values){["quantity"]="0"}},"ACCEPT_SELECTED","invalid quantity");
        Blocked(seed with{ComponentType="SUBASSEMBLY"},"USE_ENTERED_MPN","assembly exception");
        Blocked(seed with{ComponentType="DNP"},"USE_ENTERED_MPN","DNP exception");
        Blocked(seed with{WorkingState=new(true,null,"different-number",null)},"USE_ENTERED_MPN","saved manual identity exception");
        Blocked(seed with{WorkingState=new(true,null,null,"Saved manufacturer")},"USE_ENTERED_MPN","saved manufacturer-only identity exception");
        Blocked(seed with{WorkingState=new(true,"saved-assembly",null,null)},"USE_ENTERED_MPN","saved assembly identity exception");
        var confirmedSeed=classified.Rows[0] with{Index=5,RowId=seed.RowId};
        Blocked(confirmedSeed with{WorkingState=new(true,null,"different-number",null)},"ACCEPT_SELECTED","saved manual identity blocks bulk acceptance");
        Blocked(confirmedSeed with{WorkingState=new(true,null,null,"Saved manufacturer")},"ACCEPT_SELECTED","saved manufacturer-only identity blocks bulk acceptance");
        Blocked(confirmedSeed with{WorkingState=new(true,"saved-assembly",null,null)},"ACCEPT_SELECTED","saved assembly identity blocks bulk acceptance");
        Blocked(confirmedSeed with{WorkingState=new(true,null,null,"Saved manufacturer")},"USE_ENTERED_MPN","saved manufacturer-only identity is blocked before ALREADY classification");
        Blocked(seed with{ManufacturerIdentity=new([proposal],"Pending",[])},"ACCEPT_SELECTED","pending proposal cannot be blanket confirmed");
        Blocked(seed with{ManufacturerIdentity=new([proposal],"Stale",[new(proposal.Id,"CONFIRMED",actor.DisplayName,DateTimeOffset.UtcNow)],Stale:true)},"USE_ENTERED_MPN","stale manufacturer evidence");
        Blocked(seed with{ManufacturerIdentity=new([proposal with{Confidence="LOW"}],"Uncertain",[])},"USE_ENTERED_MPN","low-confidence manufacturer evidence");
        Blocked(seed with{ManufacturerIdentity=new([proposal with{PartNumber="COMPETING"}],"Different",[])},"USE_ENTERED_MPN","competing manufacturer number");
        var partialRows=accepted.Rows.ToArray();partialRows[4]=seed with{Index=4,RowId=accepted.Rows[4].RowId,Values=new(seed.Values){["lineNumber"]="5"}};partialRows[5]=seed with{ComponentType="UNKNOWN"};
        var partial=accepted with{Rows=partialRows};var partialOutcome=SimCandidateBomProvider.ReviewBulk(partial,Request(partial,"ACCEPT_SELECTED",[partialRows[4],partialRows[5]]),actor);
        Check(partialOutcome.Result.Results.All(r=>r.Status=="BLOCKED")&&Serialize(partialOutcome.Bom)==Serialize(partial),"all-blocked acceptance is nonmutating");
        try{SimCandidateBomProvider.ReviewBulk(accepted with{ManualDraft=null},Request(accepted,"ACCEPT_SELECTED",accepted.Rows.Take(1)),actor);throw new Exception("Nonmanual bulk allowed");}catch(SimRfqIntakeProblem e) when(e.Code=="SIM_BULK_MANUAL_REQUIRED"){Check(true,"nonmanual candidates remain outside bulk scope");}
        foreach(var item in hashes)
        {
            var original=await File.ReadAllBytesAsync(Path.Combine(sourceRoot,"intake-documents",correlation,item.Key));
            var copied=await File.ReadAllBytesAsync(Path.Combine(files,item.Key));
            Check(Convert.ToHexString(SHA256.HashData(original))==item.Value&&Convert.ToHexString(SHA256.HashData(copied))==item.Value,"original and rendition bytes/metadata preserved: "+item.Key);
        }
        Check(live.SequenceEqual(await File.ReadAllBytesAsync(sourcePath)),"live SIM dataset and every saved scenario remain byte-for-byte unchanged");
        await File.WriteAllTextAsync(Path.Combine(root,"result.json"),view.ToJsonString());
        SourcePartNumberChecks.Run();
        Console.WriteLine("Fixture: "+root);
    }
}
