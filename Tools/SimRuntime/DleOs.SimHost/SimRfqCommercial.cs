using System.Text.Json;

internal sealed record SimRfqOrderLink(string IntakeId,string ApprovalId,int ApprovalVersion,string QuoteNumber,
    string? CustomerPoDocumentId=null,string? NewOrderIntakeId=null,string? SalesOrderId=null,string? WorkOrderId=null);
internal sealed record SimRfqCommercialEvent(string RequestId,string Action,string From,string To,int Revision,
    string? ApprovalId,int? ApprovalVersion,DateTimeOffset At,string ActorId,string Actor,string Reason,
    DateTimeOffset? SubmittedAt,DateTimeOffset? ExpiresAt);
internal sealed record SimRfqCommercial(string Status="OPEN",int Revision=0,string? ApprovalId=null,int? ApprovalVersion=null,
    DateTimeOffset? SubmittedAt=null,DateTimeOffset? ExpiresAt=null,DateTimeOffset? ClosedAt=null,string? CloseReason=null,
    SimRfqCommercialEvent[]? History=null,SimRfqOrderLink[]? OrderLinks=null,string BusinessTimeZone="America/Los_Angeles");
internal sealed record SimRfqCommercialRequest(string RequestId,int ExpectedRevision,string Action,string? ApprovalId=null,int? ApprovalVersion=null,string Reason="");
internal sealed record SimRfqListItem(string IntakeId,SimRfqIntakeCustomer Customer,SimRfqIntakeAssembly[] Assemblies,
    string IntakeStatus,DateTimeOffset CreatedAt,string Scope,bool WorkbenchEligible,string WorkStatus,string Bucket,string Status,
    string? QuoteNumber,decimal? QuoteTotal,DateTimeOffset? ApprovedAt,bool RevisionNeeded,string MaterialsStatus,string LaborStatus,
    SimRfqCommercial Commercial);

internal static class SimRfqCommercialClock
{
    internal static TimeZoneInfo Zone => TimeZoneInfo.FindSystemTimeZoneById("America/Los_Angeles");
    internal static DateTimeOffset AddCalendarDays(DateTimeOffset instant,int days)
    {
        var local=TimeZoneInfo.ConvertTime(instant,Zone).DateTime.AddDays(days);
        // Spring-forward gaps advance to the first valid minute. Fall-back uses standard offset.
        while(Zone.IsInvalidTime(local))local=local.AddMinutes(1);
        return new DateTimeOffset(local,Zone.GetUtcOffset(local)).ToUniversalTime();
    }
    internal static string EffectiveStatus(SimRfqCommercial c,DateTimeOffset now) =>
        c.Status=="SUBMITTED"&&c.ExpiresAt is {} expiry&&now>=expiry?"EXPIRED":c.Status;
    internal static bool Completed(string status)=>status is "AWARDED" or "EXPIRED" or "LOST" or "CLOSED";
}

internal sealed partial class SimRfqIntakeStore
{
    private static SimRfqListItem CommercialView(SimRfqIntakeRecord r,SimRfqLanes lanes,DateTimeOffset now)
    {
        var c=lanes.Commercial??new();var review=FinalReviewView(r,lanes);
        var latest=review.Approvals.LastOrDefault();
        var governing=c.ApprovalId is null?latest:review.Approvals.SingleOrDefault(a=>a.Id==c.ApprovalId&&a.Version==c.ApprovalVersion);
        var eligible=RfqEligible(r);
        var work=!eligible?(r.TechnicalReview is null?"Intake":"Technical Review"):
            review.ApprovalCurrent?"Approved — Not Submitted":
            lanes.Materials.Status=="COMPLETE"&&lanes.Labor.Status=="COMPLETE"?"Final Review":
            lanes.Materials.Status=="NOT_STARTED"&&lanes.Labor.Status=="NOT_STARTED"?"Ready to Quote":
            lanes.Materials.Status!="COMPLETE"&&lanes.Labor.Status!="COMPLETE"?"Materials & Labor":
            lanes.Materials.Status!="COMPLETE"?"Materials":"Labor";
        var effective=SimRfqCommercialClock.EffectiveStatus(c,now);
        var status=effective switch {"OPEN"=>work,"SUBMITTED"=>c.ExpiresAt is {} expiry&&SimRfqCommercialClock.AddCalendarDays(now,7)>=expiry?"Expiring Soon":"Submitted",
            "AWARDED"=>"Awarded","EXPIRED"=>"Expired","LOST"=>"Lost","CLOSED"=>"Closed",_=>work};
        var revisionNeeded=c.ApprovalId is not null&&(governing is null||governing.SourceToken!=review.SourceToken||!review.ApprovalCurrent||latest?.Id!=governing.Id);
        var assemblies=governing is null?r.Assemblies:[new SimRfqIntakeAssembly(1,governing.Summary.Assembly,governing.Summary.Revision,governing.Summary.Quantity)];
        return new(r.IntakeId,governing is null?r.Customer:r.Customer with{CustomerName=governing.Summary.Customer},assemblies,r.Status,r.CreatedAtUtc,r.DeLeonScope,eligible,work,
            SimRfqCommercialClock.Completed(effective)?"HISTORY":effective=="SUBMITTED"?"SUBMITTED":"ACTIVE",status,
            governing is null?null:SimQuotationPdf.QuoteNumber(governing),governing?.Summary.QuoteTotal??review.Summary.QuoteTotal,
            governing?.ApprovedAt,revisionNeeded,lanes.Materials.Status,lanes.Labor.Status,c);
    }
    internal async Task<SimRfqListItem[]> ReadRfqCommercialList(DateTimeOffset? clock=null)
    {
        await gate.WaitAsync();
        try{
            var lanes=await ReadRfqLanes();var now=clock??DateTimeOffset.UtcNow;
            return (await ReadDatasetAsync()).Records.Where(r=>r.Environment=="SIM"&&r.IntakeType=="NEW_QUOTE_REQUEST")
                .Select(r=>CommercialView(r,lanes.GetValueOrDefault(r.IntakeId)??new(new(),new()),now)).ToArray();
        }finally{gate.Release();}
    }
    internal async Task<SimRfqListItem> TransitionRfqCommercial(string id,SimRfqCommercialRequest request,SimPersona persona,DateTimeOffset? clock=null)
    {
        await gate.WaitAsync();
        try{
            var r=(await ReadDatasetAsync()).Records.SingleOrDefault(r=>r.IntakeId==id&&r.Environment=="SIM"&&r.IntakeType=="NEW_QUOTE_REQUEST")
                ??throw SimRfqIntakeProblem.NotFound("RFQ_NOT_FOUND","RFQ not found.");
            var lanes=await ReadRfqLanes();var lane=lanes.GetValueOrDefault(id)??new(new(),new());var c=lane.Commercial??new();var now=clock??DateTimeOffset.UtcNow;
            if(!Guid.TryParse(request.RequestId,out _)||request.Reason is null||request.Reason.Length>2000)
                throw SimRfqIntakeProblem.BadRequest("COMMERCIAL_VALUES","Use a request ID and a reason up to 2000 characters.");
            var history=c.History??[];
            var duplicate=history.SingleOrDefault(h=>h.RequestId==request.RequestId);
            if(duplicate is not null){
                if(duplicate.Action!=request.Action||duplicate.ApprovalId!=request.ApprovalId||duplicate.ApprovalVersion!=request.ApprovalVersion||duplicate.Reason!=request.Reason.Trim()||duplicate.Revision!=request.ExpectedRevision+1)
                    throw SimRfqIntakeProblem.Conflict("COMMERCIAL_REQUEST_REUSED","Request ID was used for a different transition.");
                return CommercialView(r,lane,now);
            }
            if(c.Revision!=request.ExpectedRevision)throw SimRfqIntakeProblem.Conflict("COMMERCIAL_STALE","Commercial state changed. Refresh before continuing.");
            var action=request.Action;var next=c;
            if(action!="SUBMIT"&&(request.ApprovalId!=c.ApprovalId||request.ApprovalVersion!=c.ApprovalVersion))
                throw SimRfqIntakeProblem.Conflict("COMMERCIAL_APPROVAL","Identify the governing commercial approval.");
            if(action=="SUBMIT"){
                var review=FinalReviewView(r,lane);var approval=review.Approvals.LastOrDefault();
                if(!review.ApprovalCurrent||approval is null||approval.Id!=request.ApprovalId||approval.Version!=request.ApprovalVersion)
                    throw SimRfqIntakeProblem.Conflict("COMMERCIAL_APPROVAL","Submit the exact current approved quotation.");
                if(c.Status is not ("OPEN" or "SUBMITTED" or "EXPIRED")||c.ApprovalId==approval.Id)
                    throw SimRfqIntakeProblem.Conflict("COMMERCIAL_TRANSITION","This quotation cannot be submitted again. Approve a new revision first.");
                next=c with{Status="SUBMITTED",ApprovalId=approval.Id,ApprovalVersion=approval.Version,SubmittedAt=now.ToUniversalTime(),
                    ExpiresAt=SimRfqCommercialClock.AddCalendarDays(now,30),ClosedAt=null,CloseReason=null};
            }else if(action=="EXPIRE"){
                if(c.Status=="EXPIRED")return CommercialView(r,lane,now);
                if(c.Status!="SUBMITTED"||c.ExpiresAt is null||now<c.ExpiresAt)
                    throw SimRfqIntakeProblem.Conflict("COMMERCIAL_NOT_DUE","Only an overdue submitted quotation can expire.");
                next=c with{Status="EXPIRED",ClosedAt=c.ExpiresAt,CloseReason="Quote validity elapsed"};
            }else if(action is "AWARD" or "LOSE" or "CLOSE"){
                if(SimRfqCommercialClock.Completed(SimRfqCommercialClock.EffectiveStatus(c,now)))
                    throw SimRfqIntakeProblem.Conflict("COMMERCIAL_CLOSED","This opportunity is already closed or expired.");
                if(string.IsNullOrWhiteSpace(request.Reason))throw SimRfqIntakeProblem.BadRequest("COMMERCIAL_REASON","Record the commercial decision/evidence reference.");
                if(action=="AWARD"&&(c.Status!="SUBMITTED"||c.ApprovalId!=request.ApprovalId||c.ApprovalVersion!=request.ApprovalVersion||!(lane.FinalReviews??[]).Any(a=>a.Id==c.ApprovalId&&a.Version==c.ApprovalVersion)))
                    throw SimRfqIntakeProblem.Conflict("COMMERCIAL_AWARD","Award must identify the exact submitted approval.");
                next=c with{Status=action=="AWARD"?"AWARDED":action=="LOSE"?"LOST":"CLOSED",ClosedAt=now.ToUniversalTime(),CloseReason=request.Reason.Trim()};
            }else throw SimRfqIntakeProblem.BadRequest("COMMERCIAL_ACTION","Unsupported commercial action.");
            var entry=new SimRfqCommercialEvent(request.RequestId,action,c.Status,next.Status,c.Revision+1,request.ApprovalId,request.ApprovalVersion,
                now.ToUniversalTime(),persona.Id,persona.DisplayName,request.Reason.Trim(),next.SubmittedAt,next.ExpiresAt);
            next=next with{Revision=c.Revision+1,History=history.Append(entry).ToArray(),OrderLinks=c.OrderLinks??[]};
            lane=lane with{Commercial=next};lanes[id]=lane;
            Directory.CreateDirectory(Path.GetDirectoryName(RfqLanesPath)!);
            var temporary=RfqLanesPath+".write-"+Guid.NewGuid().ToString("N");
            try{var text=JsonSerializer.Serialize(lanes,jsonOptions);await File.WriteAllTextAsync(temporary,text);if(await File.ReadAllTextAsync(temporary)!=text)throw new IOException("Commercial write verification failed.");File.Move(temporary,RfqLanesPath,true);}
            finally{if(File.Exists(temporary))File.Delete(temporary);}
            return CommercialView(r,lane,now);
        }finally{gate.Release();}
    }
}

internal static partial class SimRfqIntakeEndpoints
{
    private static void MapRfqCommercial(WebApplication app,SimStateStore state,SimRfqIntakeStore store,SimPersonaSessionStore personas)
    {
        app.MapGet("/api/sim/rfqs/commercial",async Task<IResult>(HttpContext context)=>{
            var denied=DeniedTechnicalReview(context,state,personas,"technical_review.view");if(denied is not null)return denied;
            return Results.Json(new{items=await store.ReadRfqCommercialList()});
        });
        app.MapPost("/api/sim/rfqs/{id}/commercial",async Task<IResult>(string id,SimRfqCommercialRequest request,HttpContext context)=>{
            var denied=DeniedTechnicalReview(context,state,personas,"technical_review.disposition");if(denied is not null)return denied;
            try{return Results.Json(await store.TransitionRfqCommercial(id,request,personas.Resolve(context)));}
            catch(SimRfqIntakeProblem p){return Results.Json(new{message=p.Message,code=p.Code},statusCode:p.StatusCode);}
            catch(IOException){return Results.Json(new{message="Commercial state could not be saved. Retry the same request."},statusCode:503);}
        });
    }
}
