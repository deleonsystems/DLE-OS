// Read-only commercial outcome. Never alters quote validity or order acceptance.
internal sealed record SimRfqLinkedOrder(string IntakeId, string CustomerPo, int? Quantity,
    string Status, DateTimeOffset? SubmittedAt, DateTimeOffset? AcceptedAt, string? PoUrl);
internal sealed record SimRfqHistory(DateTimeOffset? ActivityAt, string ActivityLabel, SimRfqLinkedOrder[] Orders);

internal static class SimRfqHistoryProjection
{
    internal static SimRfqListItem Apply(SimRfqListItem item, IEnumerable<SimRfqIntakeRecord> records)
    {
        var links=new List<SimRfqLinkedOrder>();
        foreach(var r in records.Where(r=>r.Environment=="SIM" && r.IntakeType=="NEW_ORDER"))
        {
            var acceptance=r.OrderEntry?.Acceptance;
            var p=acceptance?.Package ?? r.OrderIntake;
            var q=p?.Quote?.Reference;
            if(p is null || q is null || q.IntakeId!=item.IntakeId || q.ApprovalId!=item.Commercial.ApprovalId ||
                q.ApprovalVersion!=item.Commercial.ApprovalVersion || q.QuoteNumber!=item.QuoteNumber) continue;
            var po=p.PoEvidence.FirstOrDefault(e=>e.Document.BinaryStatus=="VERIFIED" && !string.IsNullOrWhiteSpace(e.Document.DocumentId) && !string.IsNullOrWhiteSpace(e.Sha256));
            var submitted=po is not null && !string.IsNullOrWhiteSpace(p.PoNumber) && (acceptance is not null || p.ReviewStatus=="READY_FOR_CONTRACT_REVIEW");
            var submittedAt=submitted?p.History.Where(h=>h.Action=="SUBMIT_FOR_CONTRACT_REVIEW").Select(h=>(DateTimeOffset?)h.At).Max():null;
            links.Add(new(r.IntakeId,p.PoNumber,p.Facts.Lines.FirstOrDefault()?.Quantity,
                acceptance is not null && submitted ? "Order accepted" : submitted ? "Pending contract acceptance" : p.ReviewStatus=="DRAFT" ? "Draft order linked" : "PO submission needs review",
                submittedAt,submitted?acceptance?.At:null,
                po is null?null:$"/api/sim/new-orders/{Uri.EscapeDataString(r.IntakeId)}/documents/{Uri.EscapeDataString(po.Document.DocumentId!)}"));
        }
        var orders=links.OrderByDescending(o=>o.AcceptedAt??o.SubmittedAt).ThenBy(o=>o.IntakeId,StringComparer.Ordinal).ToArray();
        var awarded=orders.Any(o=>o.Status is "Order accepted" or "Pending contract acceptance") && item.Commercial.Status is "SUBMITTED" or "AWARDED";
        DateTimeOffset? at=null;var label="Date not recorded";
        if(awarded) {
            var latest=orders.FirstOrDefault(o=>(o.Status is "Order accepted" or "Pending contract acceptance") && (o.AcceptedAt??o.SubmittedAt) is not null);
            if(latest is not null) {at=latest.AcceptedAt??latest.SubmittedAt;label=latest.AcceptedAt is not null?"Order accepted":"PO submitted for review";}
        } else if(item.Bucket=="HISTORY") {
            if(item.Commercial.ClosedAt is {} closed){at=closed;label="Commercial closure";}
            else if(item.Status=="Expired" && item.Commercial.ExpiresAt is {} expiry){at=expiry;label="Quote expired";}
            else if(item.Commercial.SubmittedAt is {} submitted){at=submitted;label="Quote submitted";}
        }
        return item with{Bucket=awarded?"HISTORY":item.Bucket,Status=awarded?"Awarded":item.Status,
            History=new(at,label,orders)};
    }
}
