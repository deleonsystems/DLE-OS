using System.Text.Json;

internal sealed record SimCandidateBulkRow(string RowId,string ExpectedToken);
internal sealed record SimCandidateBulkReview(string Action,SimCandidateBulkRow[] Rows);
internal sealed record SimCandidateBulkRowResult(string RowId,int RowIndex,string LineNumber,string Status,string? Code,string Message);
internal sealed record SimCandidateBulkResult(string Action,SimCandidateBulkRowResult[] Results,int ChangedCount);

internal static partial class SimCandidateBomProvider
{
    internal static (SimCandidateBom Bom,SimCandidateBulkResult Result) ReviewBulk(SimCandidateBom bom,SimCandidateReviewRequest request,SimPersona persona)
    {
        var batch=request.BulkReview!;
        if(request.CandidateId!=bom.Id)throw SimRfqIntakeProblem.Conflict("SIM_CANDIDATE_STALE","Reopen the current candidate before applying selected rows.");
        if(bom.ManualDraft is null)throw SimRfqIntakeProblem.BadRequest("SIM_BULK_MANUAL_REQUIRED","Selected-row actions currently apply to DLE-authored working BOMs only.");
        if(request.Values is not null||request.ProgressRows is not null||request.WorksheetAcceptance is not null||request.PrimarySelection is not null||request.WholeRowApproval is not null||request.ComponentChange is not null||request.ManufacturerChange is not null||request.AlternateChange is not null||request.ApprovedPartChange is not null||request.IdentityBasisChange is not null||request.SourcePartNumberChange is not null||
            batch.Action is not ("USE_ENTERED_MPN" or "ACCEPT_SELECTED")||batch.Rows is null||batch.Rows.Length is <1 or >1000||batch.Rows.Any(r=>r is null||!Guid.TryParseExact(r.RowId,"D",out _)||string.IsNullOrWhiteSpace(r.ExpectedToken))||batch.Rows.Select(r=>r.RowId).Distinct().Count()!=batch.Rows.Length)
            throw SimRfqIntakeProblem.BadRequest("SIM_BULK_INVALID","Choose unique current rows and one selected-row action independently of other edits.");
        var current=bom;var results=new List<SimCandidateBulkRowResult>();
        foreach(var selected in batch.Rows)
        {
            var index=Array.FindIndex(current.Rows,r=>r.RowId==selected.RowId);
            var row=index<0?null:current.Rows[index];
            var line=row?.Values.GetValueOrDefault("lineNumber")??"";
            void Result(string status,string? code,string message)=>results.Add(new(selected.RowId,index,line,status,code,message));
            if(row is null){Result("BLOCKED","SIM_ROW_NOT_FOUND","This row no longer belongs to the current candidate.");continue;}
            if(selected.ExpectedToken!=row.ReviewState.Token){Result("BLOCKED","SIM_ROW_APPROVAL_STALE","This row changed. Reopen before applying it.");continue;}
            try
            {
                SimCandidateBom updated;
                if(batch.Action=="USE_ENTERED_MPN")
                {
                    if(row.ComponentType is "DNP" or "SUBASSEMBLY"||row.IdentityBasis=="ASSEMBLY_PN")
                        throw SimRfqIntakeProblem.Conflict("SIM_BULK_IDENTITY_EXCEPTION","Use individual review for a DNP disposition or Assembly P/N identity.");
                    if(row.WorkingState is {ManualPartNumber.Length:>0} or {AssemblyPartNumber.Length:>0} or {ManufacturerName.Length:>0})
                        throw SimRfqIntakeProblem.Conflict("SIM_SOURCE_PN_DRAFT","Resolve saved identity edits individually before using entered numbers.");
                    if(row.SourcePartNumberReview?.Current is {Status:"CONFIRMED",Basis:"MFG"}&&SourceIdentityMatches(row))
                    {Result("ALREADY",null,"Entered number is already confirmed as Manufacturer P/N.");continue;}
                    if(row.ManufacturerIdentity is { } identity&&(identity.Stale||identity.Proposals.Any(p=>identity.Decision(p.Id) is not ("REJECTED" or "NOT_SELECTED" or "SUPERSEDED")&&(p.Confidence=="LOW"||p.Conflicts.Length>0))))
                        throw SimRfqIntakeProblem.Conflict("SIM_BULK_IDENTITY_REVIEW","Review stale, conflicting or uncertain manufacturer evidence individually.");
                    updated=Review(current,new(current.Id,index,null,SourcePartNumberChange:new("MFG",selected.ExpectedToken)),persona);
                    Result("UPDATED",null,"Entered number classified as Manufacturer P/N. Row still requires Accept.");
                }
                else
                {
                    if(row.ReviewState.Reviewed){Result("ALREADY",null,"Row is already accepted.");continue;}
                    var blockers=row.ReviewState.ApprovalBlockers.Where(reason=>reason!="Saved working changes need row Accept before completion.").ToList();
                    if(row.WorkingState is {ManualPartNumber.Length:>0} or {AssemblyPartNumber.Length:>0} or {ManufacturerName.Length:>0})
                        blockers.Add("Resolve saved identity edits individually before accepting selected rows.");
                    if(row.ComponentType!="DNP"&&row.IdentityBasis=="MANUFACTURER_PN")
                    {
                        var identity=row.ManufacturerIdentity;
                        if(identity is null||!identity.Proposals.Any(p=>identity.Decision(p.Id)=="CONFIRMED"&&!string.IsNullOrWhiteSpace(p.PartNumber)))
                            blockers.Add("Confirm a Manufacturer P/N identity before accepting this row.");
                        if(identity is not null&&identity.Proposals.Any(p=>identity.Decision(p.Id) is not ("CONFIRMED" or "REJECTED")))
                            blockers.Add("Resolve pending or competing manufacturer identities individually before accepting selected rows.");
                    }
                    if(blockers.Count>0)throw SimRfqIntakeProblem.Conflict("SIM_ROW_APPROVAL_BLOCKED",string.Join(" ",blockers.Distinct()));
                    updated=Review(current,new(current.Id,index,new(row.Values),WorksheetAcceptance:new(selected.ExpectedToken,row.ComponentType,AssemblyPartNumber:row.AssemblyIdentity?.PartNumber)),persona);
                    // Some legacy single-row paths replace this array. Bulk acceptance preserves all prior decisions.
                    var accepted=updated.Rows[index];
                    var history=(row.WholeRowHistory??[]).Concat((accepted.WholeRowHistory??[]).Where(a=>!(row.WholeRowHistory??[]).Contains(a))).ToArray();
                    var rows=updated.Rows.ToArray();rows[index]=accepted with{WholeRowHistory=history};updated=updated with{Rows=rows};
                    Result("ACCEPTED",null,"Row accepted using its saved values and reviewed identity.");
                }
                current=updated;
            }
            catch(SimRfqIntakeProblem error){Result("BLOCKED",error.Code,error.Message);}
        }
        return(current,new(batch.Action,results.ToArray(),results.Count(r=>r.Status is "UPDATED" or "ACCEPTED")));
    }
}

internal sealed partial class SimRfqIntakeStore
{
    private static object BulkWorkflowEnvelope(SimRfqIntakeRecord record,SimCandidateBulkResult result)
    {
        var envelope=JsonSerializer.SerializeToNode(WorkflowEnvelope(record),DleAnalysisContract.Json)!.AsObject();
        envelope["bulkResult"]=JsonSerializer.SerializeToNode(result,DleAnalysisContract.Json);
        return envelope;
    }
}
