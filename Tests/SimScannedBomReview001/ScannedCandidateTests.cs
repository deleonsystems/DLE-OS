using System.Text.Json;
using System.Text.Json.Nodes;

internal static class ScannedCandidateTests
{
    internal static async Task Run(SimRfqIntakeStore store, SimRfqIntakeRecord record, SimPersona persona, string dataPath, JsonSerializerOptions options)
    {
        void Check(bool ok,string label){if(!ok)throw new Exception(label);Console.WriteLine("PASS: "+label);}
        JsonElement Envelope(object? value)=>JsonSerializer.SerializeToElement(value,options);
        async Task Reject(Func<Task> action,string code){try{await action();throw new Exception("Expected "+code);}catch(SimRfqIntakeProblem e){Check(e.Code==code,code+": "+e.Message);}}
        var original=record.TechnicalReview!.ScannedBomReview!;
        var opened=Envelope(await store.OpenScannedBomReview(record.IntakeId));
        var request=new SimScanCandidateRequest(original.Id,original.Version,opened.GetProperty("packageReviewToken").GetString()!);
        var edits=original.Rows.Select(r=>new SimScanRowEdit(r.Position,r.RowType,r.Cells.ToDictionary(c=>c.Key,c=>c.Value.Value),r.SourceNote,true)).ToArray();
        edits[27].Values["REFERENCE_DESIGNATORS"]="UNRESOLVED-CONTINUATION";
        edits[26].Values["REFERENCE_DESIGNATORS"]="BEFORE-MERGE";
        edits[0].Values["REFERENCE_DESIGNATORS"]="CORRECTED-U1";edits[0].Values["UNIT"]="EA";
        var save=new SimScanSaveRequest(original.Id,original.Version,original.Setup.DocumentId,original.Setup.Sha256,original.Setup.Id,request.ExpectedReviewToken,edits);
        var saved=Envelope(await store.SaveScannedBomReview(record.IntakeId,save,persona));
        request=request with {ExpectedVersion=original.Version+1,ExpectedReviewToken=saved.GetProperty("packageReviewToken").GetString()!};
        await Reject(async()=>{await store.BuildScannedCandidate(record.IntakeId,request,persona);},"SCAN_CANDIDATE_BLOCKED");
        edits[27].Values["REFERENCE_DESIGNATORS"]="";
        saved=Envelope(await store.SaveScannedBomReview(record.IntakeId,save with {ExpectedVersion=request.ExpectedVersion,ExpectedReviewToken=request.ExpectedReviewToken,Rows=edits},persona));
        request=request with {ExpectedVersion=request.ExpectedVersion+1,ExpectedReviewToken=saved.GetProperty("packageReviewToken").GetString()!};
        Check(saved.GetProperty("scannedCandidate").GetProperty("canSubmit").GetBoolean(),"accepted, saved, structurally valid worksheet eligible");
        await File.WriteAllTextAsync(Path.Combine(Path.GetDirectoryName(dataPath)!,"eligible-envelope.json"),saved.GetRawText());
        var built=Envelope(await store.BuildScannedCandidate(record.IntakeId,request,persona));
        await File.WriteAllTextAsync(Path.Combine(Path.GetDirectoryName(dataPath)!,"candidate-envelope.json"),built.GetRawText());
        var result=built.GetProperty("record").Deserialize<SimRfqIntakeRecord>(options)!;
        var bom=result.TechnicalReview!.CandidateBom!;
        Check(built.GetProperty("scannedCandidate").GetProperty("status").GetString()=="READY","build ready");
        Check(bom.Rows.Length==edits.Count(r=>r.RowType=="COMPONENT") && bom.Rows[0].Values["designators"]=="CORRECTED-U1" && bom.Rows[0].Values["unit"]=="EA","component-only mapping consumes corrected values and UoM");
        Check(bom.Rows.Single(r=>r.RowId!.EndsWith("-41")).ManufacturerIdentity!.Proposals.Length==3 && bom.Rows.All(r=>r.Alternates is null && !r.Confirmed),"three identities are proposals, no alternates or technical approvals inferred");
        Check(bom.ReviewedScanSource!.Worksheet.Rows.Length==106 && bom.ReviewedScanSource.Worksheet.Setup.Id==original.Setup.Id && bom.Rows[0].AnalysisFields!["designators"].Evidence.Page==3,"all excluded rows, original setup/hash/cell evidence retained");
        var before=await File.ReadAllTextAsync(dataPath);
        await store.BuildScannedCandidate(record.IntakeId,request,persona);await store.OpenScannedBomReview(record.IntakeId);
        Check(await File.ReadAllTextAsync(dataPath)==before,"duplicate submit and reopen do not create versions or write");
        // Normal candidate review contract accepts the generated candidate and retains its source snapshot.
        await store.CandidateBomAsync(record.IntakeId,persona,new(bom.Id,0,null,ComponentChange:new("OTHER",0)));
        var current=Envelope(await store.OpenScannedBomReview(record.IntakeId));
        edits[0].Values["DESCRIPTION"]="Updated after build";
        edits[26].Values["REFERENCE_DESIGNATORS"]=original.Rows[26].Cells["REFERENCE_DESIGNATORS"].Value;
        saved=Envelope(await store.SaveScannedBomReview(record.IntakeId,save with {ExpectedVersion=request.ExpectedVersion,ExpectedReviewToken=current.GetProperty("packageReviewToken").GetString()!,Rows=edits},persona));
        Check(saved.GetProperty("scannedCandidate").GetProperty("status").GetString()=="NEEDS_REBUILD","worksheet save invalidates candidate");
        await Reject(async()=>{await store.CandidateBomAsync(record.IntakeId,persona,new(bom.Id,0,null,ComponentChange:new("STANDARD_COTS",1)));},"SIM_CANDIDATE_REQUIRED");
        await Reject(async()=>{await store.BuildScannedCandidate(record.IntakeId,request,persona);},"SCAN_REVIEW_STALE");
        request=request with {ExpectedVersion=request.ExpectedVersion+1,ExpectedReviewToken=saved.GetProperty("packageReviewToken").GetString()!};
        var stale=saved.GetProperty("record").Deserialize<SimRfqIntakeRecord>(options)!;
        Check(stale.TechnicalReview!.CandidateBom is null && stale.TechnicalReview.CandidateBomVersions!.Last().Id==bom.Id,"save immediately removes current candidate and archives it");
        var rebuiltEnvelope=Envelope(await store.BuildScannedCandidate(record.IntakeId,request,persona));
        var rebuilt=rebuiltEnvelope.GetProperty("record").Deserialize<SimRfqIntakeRecord>(options)!;
        Check(rebuilt.TechnicalReview!.CandidateBomVersions!.Length==1 && rebuilt.TechnicalReview.CandidateBom!.Rows[0].Values["description"]=="Updated after build","rebuild archives exactly one prior candidate and uses latest correction");
        var fresh=rebuilt.TechnicalReview!.CandidateBom!;
        Check(fresh.Id!=bom.Id && fresh.Rows[0].ComponentType=="STANDARD_COTS" && fresh.Rows[0].ComponentTypeRevision==0 && fresh.Rows.All(r=>!r.Confirmed && r.Corrections.Length==0 && r.ManufacturerIdentity!.History.Length==0 && r.Alternates is null),"fresh build carries no previous candidate decisions");
        Check(fresh.Rows.Single(r=>r.RowId!.EndsWith("-27")).Values["designators"]==original.Rows[26].Cells["REFERENCE_DESIGNATORS"].Value && fresh.ReviewedScanSource!.Worksheet.Rows[27].RowType=="CONTINUATION","latest merged Find 27 value mapped; empty continuation retained only as evidence");
        Check(rebuiltEnvelope.GetProperty("scannedCandidate").GetProperty("status").GetString()=="READY","fresh candidate ready");
        var afterRebuild=await File.ReadAllTextAsync(dataPath);
        await store.BuildScannedCandidate(record.IntakeId,request,persona);
        Check(await File.ReadAllTextAsync(dataPath)==afterRebuild,"repeated rebuild creates no duplicate history or current candidate");
        Console.WriteLine($"LIFECYCLE previous={bom.Id} worksheet-v{bom.ReviewedScanSource!.Worksheet.Version} fingerprint={bom.ReviewedScanSource.Fingerprint}; new={fresh.Id} worksheet-v{fresh.ReviewedScanSource!.Worksheet.Version} fingerprint={fresh.ReviewedScanSource.Fingerprint}; rows={fresh.Rows.Length}; Find27={fresh.Rows.Single(r=>r.RowId!.EndsWith("-27")).Values["designators"]}");
        var node=JsonNode.Parse(await File.ReadAllTextAsync(dataPath))!;node["records"]![0]!["technicalReview"]!["scannedBomReview"]!["setup"]!["sha256"]="changed";await File.WriteAllTextAsync(dataPath,node.ToJsonString());
        await Reject(async()=>{await store.BuildScannedCandidate(record.IntakeId,request,persona);},"SCAN_REVIEW_SOURCE_UNAVAILABLE");
        Console.WriteLine("All candidate tests used disposable storage; no OCR/provider invoked: "+dataPath);
    }
}
