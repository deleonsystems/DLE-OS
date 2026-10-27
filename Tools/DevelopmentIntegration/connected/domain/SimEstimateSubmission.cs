using System.Text.Json;

// Internal handoff receipt only. Never customer issuance or part approval.
internal sealed record SimEstimateSubmission(int Revision,string RequestId,string ExpectedToken,string SourceToken,SimEstimatePair Pair,string ActorId,string ActorName,DateTimeOffset AtUtc);
internal sealed record SimEstimateSubmitRequest(string RequestId,int ExpectedRevision,string ExpectedToken,string EstimateId);
internal sealed record SimEstimateSubmissionView(int ContractVersion,string RfqId,string ParentIntakeId,int LineNumber,int Revision,string Token,string? EstimateId,bool Current,bool CanSubmit,string[] Blockers,SimEstimateSubmission[] History,bool CustomerIssued=false);
internal sealed record SimEstimateParentGroup(string ParentIntakeId,int TotalLines,int SubmittedLines,string Status,int ManuallySentLines=0,string ManualSendStatus="NOT_RECORDED");

internal sealed partial class SimRfqIntakeStore
{
    private async Task<SimEstimateSubmissionView> EstimateSubmissionView(SimRfqIntakeRecord record,SimRfqLanes lanes,SimPersona? persona)
    {
        EstimateRequire(record.LibraryRfq is not null,"Independent internal submission requires an approved Library-backed RFQ line.");
        var review=FinalReviewView(record,lanes);var summary=review.Summary;var routes=await PartEstimateRoutes(record,lanes);
        var blockers=new List<string>();
        if(!summary.TechnicalComplete||!summary.TechnicalPackageAvailable)blockers.Add("Confirm the approved technical package for this line.");
        if(record.Assemblies.Length!=1||summary.Quantity<=0)blockers.Add("A valid quantity for one assembly is required.");
        if(record.DeLeonScope!="LABOR_ONLY"&&!summary.MaterialsComplete)blockers.Add("Complete Materials for this line's current approved BOM and quantity.");
        if(record.DeLeonScope!="MATERIAL_ONLY"&&!summary.LaborComplete)blockers.Add("Complete Labor for this line's current manufacturing definition and quantity.");
        if(summary.CombinedUnitPrice is null or <0)blockers.Add("Complete valid pricing for this line.");
        foreach(var flag in summary.MaterialPartFlags??[])if(!routes.Any(r=>r.Index==flag.Index&&r.AllowedForEstimate))blockers.Add("Find "+flag.Find+": resolve its part request or obtain an authorized estimate-only allowance.");
        blockers.AddRange(RfqSectionHoldBlockers(lanes));
        if(QuotationEditBlocker(record.IntakeId,lanes.Commercial,(await ReadDatasetAsync()).Records) is {} committed)blockers.Add(committed);
        var pairs=EstimatePairs(record,lanes);var currentId=CurrentEstimateReview(record,lanes,pairs);var pair=pairs.SingleOrDefault(p=>p.Id==currentId);
        if(pair is null)blockers.Add("Complete both requested sections before submitting this line's estimate.");
        else _=await VerifyEstimatePair(record,lanes,pair);
        var history=lanes.EstimateSubmissions??[];
        EstimateRequire(history.Select((h,i)=>h.Revision==i+1&&h.Pair.RfqId==record.IntakeId).All(v=>v)&&history.Select(h=>h.RequestId).Distinct().Count()==history.Length,"Internal estimate submission history could not be verified.");
        var source=EstimateHash(new{work=FinalSourceToken(record,lanes),routes});var latest=history.LastOrDefault();
        var current=pair is not null&&latest?.Pair.Id==pair.Id&&latest.SourceToken==source&&blockers.Count==0;
        return new(1,record.IntakeId,record.LibraryRfq!.ParentIntakeId,record.LibraryRfq.LineNumber,history.Length,EstimateHash(new{source,revision=history.Length,pair=pair?.Id}),pair?.Id,current,persona?.IsActive==true&&persona.Can("technical_review.disposition")&&blockers.Count==0&&!current,blockers.ToArray(),history);
    }
    private SimEstimateParentGroup[] EstimateParentGroups(IEnumerable<SimRfqIntakeRecord> records,SimRfqListItem[] items)=>records.Where(r=>r.QuoteComposition is not null&&r.Environment==runtimeEnvironment&&r.IntakeType=="NEW_QUOTE_REQUEST").Select(r=>{
        var submitted=r.Assemblies.Count(a=>items.Any(i=>i.LibraryRfq?.ParentIntakeId==r.IntakeId&&i.LibraryRfq.LineNumber==a.LineNumber&&i.EstimateSubmission?.Current==true));
        var manuallySent=r.Assemblies.Count(a=>items.Any(i=>i.LibraryRfq?.ParentIntakeId==r.IntakeId&&i.LibraryRfq.LineNumber==a.LineNumber&&i.ManualQuote is not null));return new SimEstimateParentGroup(r.IntakeId,r.Assemblies.Length,submitted,submitted==0?"NOT_SUBMITTED":submitted==r.Assemblies.Length?"ALL_ESTIMATES_SUBMITTED_INTERNAL":"PARTIALLY_SUBMITTED_INTERNAL",manuallySent,manuallySent==0?"NOT_RECORDED":manuallySent==r.Assemblies.Length?"ALL_SENT_MANUALLY":"PARTIALLY_SENT_MANUALLY");
    }).ToArray();
    internal async Task<SimEstimateSubmissionView> ReadEstimateSubmission(string id,SimPersona persona)
    {
        PartPermission(persona,"materials");await gate.WaitAsync();try{var r=await RequireRfqRecord(id);var lane=(await ReadRfqLanes()).GetValueOrDefault(id)??new(new(),new());return await EstimateSubmissionView(r,lane,persona);}finally{gate.Release();}
    }
    internal async Task<SimEstimateSubmissionView> SubmitEstimate(string id,SimEstimateSubmitRequest request,SimPersona persona)
    {
        PartPermission(persona,"technical-review",true);await gate.WaitAsync();try{
            var r=await RequireRfqRecord(id);var lanes=await ReadRfqLanes();var lane=lanes.GetValueOrDefault(id)??new(new(),new());var view=await EstimateSubmissionView(r,lane,persona);
            EstimateRequire(Guid.TryParseExact(request.RequestId,"D",out _),"Use a valid internal submission request identity.");
            var duplicate=view.History.SingleOrDefault(h=>h.RequestId==request.RequestId);
            if(duplicate is not null){EstimateRequire(duplicate.ActorId==persona.Id&&duplicate.ExpectedToken==request.ExpectedToken&&duplicate.Revision==request.ExpectedRevision+1&&duplicate.Pair.Id==request.EstimateId,"This request identity was already used for different content.");return view;}
            EstimateRequire(request.ExpectedRevision==view.Revision&&request.ExpectedToken==view.Token,"This estimate or its part decisions changed. Reopen this line before submitting.");
            EstimateRequire(view.CanSubmit&&view.EstimateId==request.EstimateId,view.Blockers.Length>0?string.Join(" ",view.Blockers):"This exact estimate is already submitted internally.");
            var pair=EstimatePairs(r,lane).Single(p=>p.Id==view.EstimateId);var routes=await PartEstimateRoutes(r,lane);
            var receipt=new SimEstimateSubmission(view.Revision+1,request.RequestId,request.ExpectedToken,EstimateHash(new{work=FinalSourceToken(r,lane),routes}),pair,persona.Id,persona.DisplayName,DateTimeOffset.UtcNow);
            lane=lane with{EstimatePairs=EstimatePairs(r,lane),EstimateSubmissions=[..view.History,receipt]};lanes[id]=lane;
            Directory.CreateDirectory(Path.GetDirectoryName(RfqLanesPath)!);var temporary=RfqLanesPath+".write-"+Guid.NewGuid().ToString("N");try{var text=JsonSerializer.Serialize(lanes,jsonOptions);await File.WriteAllTextAsync(temporary,text);if(await File.ReadAllTextAsync(temporary)!=text)throw new IOException("Internal submission write verification failed.");File.Move(temporary,RfqLanesPath,true);}finally{if(File.Exists(temporary))File.Delete(temporary);}
            return await EstimateSubmissionView(r,lane,persona);
        }finally{gate.Release();}
    }
}
internal static partial class SimRfqIntakeEndpoints
{
    private static void MapEstimateSubmissions(WebApplication app,SimStateStore state,SimRfqIntakeStore store,SimPersonaSessionStore personas)
    {
        app.MapGet("/api/sim/rfqs/{id}/estimate-submission",async Task<IResult>(string id,HttpContext c)=>{c.Response.Headers.CacheControl="private, no-store";var denied=DeniedTechnicalReview(c,state,personas,"rfq.readiness.view");if(denied is not null)return denied;try{return Results.Json(await store.ReadEstimateSubmission(id,personas.Resolve(c)));}catch(SimRfqIntakeProblem e){return Results.Json(new{code=e.Code,message=e.Message},statusCode:e.StatusCode);}});
        app.MapPost("/api/sim/rfqs/{id}/estimate-submission",async Task<IResult>(string id,SimEstimateSubmitRequest r,HttpContext c)=>{c.Response.Headers.CacheControl="private, no-store";var denied=DeniedTechnicalReview(c,state,personas,"technical_review.disposition");if(denied is not null)return denied;try{return Results.Json(await store.SubmitEstimate(id,r,personas.Resolve(c)));}catch(SimRfqIntakeProblem e){return Results.Json(new{code=e.Code,message=e.Message},statusCode:e.StatusCode);}catch(IOException){return Results.Json(new{code="ESTIMATE_SAVE_UNCONFIRMED",message="Internal submission outcome is unconfirmed. Reopen this line before retrying the same request."},statusCode:503);}});
    }
}
