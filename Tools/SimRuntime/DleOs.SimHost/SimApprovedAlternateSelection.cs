internal sealed record SimApprovedAlternateRequest(string? AlternateId,string ExpectedToken);
internal sealed record SimApprovedAlternateChoice(string? AlternateId,string? PartNumber,string? ManufacturerName,string SourceDocumentId,string SourceSha256,string RowPartNumber,string ComponentType,DateTimeOffset? ApprovalAtUtc,string SelectedBy,DateTimeOffset SelectedAtUtc);
internal static class SimApprovedAlternateChoices
{
    internal static SimCandidateAlternate[] Eligible(SimCandidateRow row)=>row.ComponentType is "DNP" or "SUBASSEMBLY" || row.IdentityBasis is "CUSTOMER_PN" or "ASSEMBLY_PN" || row.ManufacturerIdentity?.Stale==true || row.SourcePartNumberReview?.Current.Status=="INVALIDATED" ? [] :
        (row.Alternates??[]).Where(a=>a.RemovedAtUtc is null && a.ReviewStatus=="APPROVED" && !string.IsNullOrWhiteSpace(a.PartNumber) && a.History.LastOrDefault() is {Action:"APPROVED",ReviewStatus:"APPROVED"} h && h.Value==a.PartNumber && !string.IsNullOrWhiteSpace(h.Reviewer)).ToArray();
    internal static bool Valid(SimCandidateRow row)=>row.SelectedApprovedAlternate is {} c && c.AlternateId is not null && c.RowPartNumber==row.Values.GetValueOrDefault("partNumber") && c.ComponentType==row.ComponentType &&
        row.PrimaryIdentity is {Basis:"MANUFACTURER_PN"} p && p.PartNumber==c.PartNumber &&
        (row.SourcePartNumberReview is null || row.SourcePartNumberReview.Current.GoverningDocumentId==c.SourceDocumentId && row.SourcePartNumberReview.Current.GoverningSha256==c.SourceSha256) &&
        Eligible(row).Any(a=>a.Id==c.AlternateId && a.PartNumber==c.PartNumber && (a.ManufacturerName??"")== (c.ManufacturerName??"") && a.History.Last().AtUtc==c.ApprovalAtUtc);
}
internal static partial class SimCandidateBomProvider
{
    private static SimCandidateBom SelectApprovedAlternate(SimCandidateBom bom,SimCandidateReviewRequest request,SimPersona actor)
    {
        var change=request.ApprovedAlternateSelection!;
        if(request.CandidateId!=bom.Id || request.RowIndex<0 || request.RowIndex>=bom.Rows.Length || request.Values is not null || request.AlternateChange is not null || request.ComponentChange is not null || request.ManufacturerChange is not null || request.WholeRowApproval is not null || request.PrimarySelection is not null || request.WorksheetAcceptance is not null || request.ProgressRows is not null || request.ApprovedPartChange is not null || request.IdentityBasisChange is not null || request.SourcePartNumberChange is not null || request.BulkReview is not null)
            throw SimRfqIntakeProblem.BadRequest("SIM_ALTERNATE_SELECTION_INVALID","Choose an approved alternate independently on the current row.");
        var row=bom.Rows[request.RowIndex];if(change.ExpectedToken!=row.ReviewState.Token)throw SimRfqIntakeProblem.Conflict("SIM_ALTERNATE_SELECTION_STALE","This row changed. Reload before choosing an approved P/N.");
        var alternate=change.AlternateId is null?null:SimApprovedAlternateChoices.Eligible(row).SingleOrDefault(a=>a.Id==change.AlternateId)??throw SimRfqIntakeProblem.Conflict("SIM_ALTERNATE_NOT_APPROVED","This alternate is no longer explicitly approved and current for this row. Review its decision first.");
        var now=DateTimeOffset.UtcNow;var choice=new SimApprovedAlternateChoice(alternate?.Id,alternate?.PartNumber,alternate?.ManufacturerName,bom.GoverningDocumentId,bom.GoverningSha256,row.Values["partNumber"],row.ComponentType,alternate?.History.Last().AtUtc,actor.DisplayName,now);
        row=InvalidateSourceReview(row,actor,"Explicit Approved P/N selection; source transcription retained.","OVERRIDDEN");
        if(alternate is not null && row.SourcePartNumberReview is {Current.Status:"UNRESOLVED"} source){var decision=source.Current with{Status="OVERRIDDEN",Reviewer=actor.DisplayName,AtUtc=now,Reason="Explicit approved alternate chosen; original source identifier is unchanged and not asserted to be a manufacturer P/N."};row=row with{SourcePartNumberReview=new(decision,source.History.Append(decision).ToArray())};}
        var rows=bom.Rows.ToArray();rows[request.RowIndex]=row with{SelectedApprovedAlternate=alternate is null?null:choice,ApprovedAlternateSelectionHistory=(row.ApprovedAlternateSelectionHistory??[]).Append(choice).ToArray(),PrimaryIdentity=new("MANUFACTURER_PN",alternate?.PartNumber,row.Values["partNumber"],actor.DisplayName,now),Confirmed=false};
        return bom with{Rows=rows};
    }
}
