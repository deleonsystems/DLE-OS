using System.Security.Cryptography;
using System.Text.Json;

internal sealed record SimLaborRevisionEvent(string RequestId, int FromRevision, int ToRevision, int BaseVersion,
    string Reason, string ActorId, string Actor, DateTimeOffset At);
internal sealed record SimLaborReviseRequest(string RequestId, int ExpectedRevision, int BaseVersion, string Reason);
internal sealed record SimDrawingContent(string StepId, SimDrawingSource Source, SimDrawingMark[] Marks, string Note, [property: System.Text.Json.Serialization.JsonIgnore(Condition = System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull)] string? LayerId = null, [property: System.Text.Json.Serialization.JsonIgnore(Condition = System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull)] string? Name = null, [property: System.Text.Json.Serialization.JsonIgnore(Condition = System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull)] string[]? StepIds = null, [property: System.Text.Json.Serialization.JsonIgnore(Condition = System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull)] int? ContentRevision = null, [property: System.Text.Json.Serialization.JsonIgnore(Condition = System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull)] int? Page = null);

internal sealed partial class SimRfqIntakeStore
{
    private static string? QuotationEditBlocker(string intakeId, SimRfqCommercial? commercial, IEnumerable<SimRfqIntakeRecord> records)
    {
        if(commercial is not null && (commercial.Status!="OPEN" || commercial.SubmittedAt is not null || commercial.ApprovalId is not null ||
            (commercial.History??[]).Any(h=>h.Action=="SUBMIT") || (commercial.OrderLinks?.Length??0)>0))
            return "This quotation has a commercial commitment. A separate governed revision workflow is required.";
        if(records.Any(r=>r.OrderIntake?.Quote?.Reference.IntakeId==intakeId ||
            r.OrderIntake?.TechnicalSource?.Baseline?.Quote.IntakeId==intakeId ||
            r.OrderEntry?.Acceptance.Package.Quote?.Reference.IntakeId==intakeId))
            return "An order references this quotation. Its committed baseline cannot be reopened here.";
        return null;
    }
    private static string? LaborRevisionBlocker(SimLaborView view, IEnumerable<SimRfqIntakeRecord> records) => QuotationEditBlocker(view.Rfq.IntakeId,view.Rfq.Lanes.Commercial,records);
    private static SimDrawingContent[] DrawingContent(SimDrawingLayer[] layers, SimLaborOperation[] operations) =>
        layers.Where(l=>DrawingSteps(l).Any(id=>operations.Any(o=>o.Id==id)) && (l.LayerId is not null || l.Marks.Length>0 || !string.IsNullOrWhiteSpace(l.Note)))
            .OrderBy(l=>l.StepId,StringComparer.Ordinal).ThenBy(l=>l.Source.Sha256,StringComparer.Ordinal).ThenBy(l=>l.LayerId,StringComparer.Ordinal)
            .Select(l=>new SimDrawingContent(l.StepId,l.Source,l.Marks,l.Note,l.LayerId,l.Name,l.StepIds,l.ContentRevision,l.Page ?? (l.Marks.Select(m=>m.Page).Distinct().Count()>1 ? null : l.Marks.FirstOrDefault()?.Page ?? l.SavedView.Page))).ToArray();
    private static string DrawingContentToken(SimDrawingContent[] content) => Convert.ToHexString(SHA256.HashData(JsonSerializer.SerializeToUtf8Bytes(content)));
    private async Task<SimLaborView> LaborCapabilities(SimLaborView view, IEnumerable<SimRfqIntakeRecord> records)
    {
        var blocker=LaborRevisionBlocker(view,records);
        // Present a corrected draft preview; no persisted plan or frozen version is rewritten.
        if(blocker is null&&view.Rfq.Lanes.Labor.Status!="COMPLETE"&&view.Plan.CalculationVersion=="LABOR_BATCH_ALLOCATION_V6"){
            var preview=view.Plan with{CalculationVersion=LaborUnitBatchCalculation};
            view=view with{Plan=preview,Totals=CalculateLabor(preview.Operations,preview.Quantity,preview.Rate??0,preview.Markup,preview.Charges,preview.CommissionPercent,preview.PricingQuantity,preview.CalculationVersion),TimingCalculationPendingSave=true};
        }

        var layers=(await DrawingLayers()).GetValueOrDefault(view.Rfq.IntakeId)??[];
        return view with {RevisionContractVersion=1,CanRevise=view.Rfq.Lanes.Labor.Status=="COMPLETE" && view.Plan.Versions.Length>0 && blocker is null,
            RevisionBlocker=blocker,DrawingContentToken=DrawingContentToken(DrawingContent(layers,view.Plan.Operations))};
    }
    internal async Task<SimLaborView> ReviseLabor(string id, SimLaborReviseRequest request, SimPersona actor)
    {
        if(!actor.Can("technical_review.disposition"))throw SimRfqIntakeProblem.Conflict("LABOR_REVISE_DENIED","Labor revision is not permitted.");
        if(!Guid.TryParse(request.RequestId,out _) || string.IsNullOrWhiteSpace(request.Reason) || request.Reason.Length>2000)
            throw SimRfqIntakeProblem.BadRequest("LABOR_REVISE_REASON","Record a reason from 1 to 2000 characters and a valid request ID.");
        await gate.WaitAsync();
        try {
            var records=(await ReadDatasetAsync()).Records;var record=await RequireRfqRecord(id);
            var lanes=await ReadRfqLanes();var view=LaborView(RfqView(record,lanes));
            var duplicate=(view.Plan.RevisionHistory??[]).SingleOrDefault(e=>e.RequestId==request.RequestId);
            if(duplicate is not null){
                if(duplicate.FromRevision!=request.ExpectedRevision||duplicate.BaseVersion!=request.BaseVersion||duplicate.Reason!=request.Reason.Trim()||duplicate.ActorId!=actor.Id)
                    throw SimRfqIntakeProblem.Conflict("LABOR_REVISE_REQUEST","This request ID belongs to a different revision action.");
                return await LaborCapabilities(view,records);
            }
            if(LaborRevisionBlocker(view,records) is {} blocker)throw SimRfqIntakeProblem.Conflict("LABOR_COMMITTED",blocker);
            if(view.Plan.Revision!=request.ExpectedRevision || view.Plan.Versions.LastOrDefault()?.Version!=request.BaseVersion)
                throw SimRfqIntakeProblem.Conflict("LABOR_STALE","Labor changed. Refresh before revising.");
            if(view.Rfq.Lanes.Labor.Status!="COMPLETE")throw SimRfqIntakeProblem.Conflict("LABOR_ALREADY_OPEN","Labor is already open for editing.");
            var now=DateTimeOffset.UtcNow;
            var entry=new SimLaborRevisionEvent(request.RequestId,view.Plan.Revision,view.Plan.Revision+1,request.BaseVersion,request.Reason.Trim(),actor.Id,actor.DisplayName,now);
            var plan=view.Plan with {Revision=view.Plan.Revision+1,UpdatedBy=actor.DisplayName,AtUtc=now,RevisionHistory=(view.Plan.RevisionHistory??[]).Append(entry).ToArray()};
            lanes[id]=RetainEstimatePairs(record,view.Rfq.Lanes) with {LaborQuote=plan,Labor=new("IN_PROGRESS",actor.DisplayName,now)};
            var temporary=RfqLanesPath+".write-"+Guid.NewGuid().ToString("N");
            try{var text=JsonSerializer.Serialize(lanes,jsonOptions);await File.WriteAllTextAsync(temporary,text);if(await File.ReadAllTextAsync(temporary)!=text)throw new IOException("Revision verification failed.");File.Move(temporary,RfqLanesPath,true);}
            finally{if(File.Exists(temporary))File.Delete(temporary);}
            return await LaborCapabilities(LaborView(RfqView(record,lanes)),records);
        }finally{gate.Release();}
    }
}
