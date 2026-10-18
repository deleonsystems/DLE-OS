using System.Globalization;
using System.Security.Cryptography;
using System.Text.Json;

internal sealed record SimCustomerSupplyReview(string SourceToken, string[] PoRowIds, bool Acknowledged, string Note = "");
internal sealed record SimCustomerSupplyLine(string SourceRowId, int SourceRowIndex, string FindNumber,
    string CustomerPartNumber, string ApprovedPartNumber, string Description, decimal RequiredEach,
    decimal RequiredQuantity, string Uom, bool QuotedCustomerSupplied, string QuoteNumber, string PoNumber, string[] PoDocumentNames);
internal sealed record SimCustomerSupplyProjection(string SourceToken, SimCustomerSupplyLine[] Lines,
    string[] PoRowIds, bool Acknowledged, string Note, string[] Issues);
internal static class SimCustomerSupply
{
    internal const string Label = "C/S (Customer supplied)";
    internal static SimCustomerSupplyLine[] Lines(SimOrderTechnicalBaseline? baseline, SimOrderFacts facts, string poNumber = "", SimRfqIntakeDocument[]? documents = null)
    {
        if (baseline is null) return [];
        return baseline.Definition.Materials.Candidate.Rows.Where(r=>r.ComponentType!="DNP").Select(r=> {
            var material=baseline.Materials.Rows.SingleOrDefault(m=>m.Quote.Index==r.Index);
            var per=decimal.TryParse(r.Values.GetValueOrDefault("quantity"),NumberStyles.Number,CultureInfo.InvariantCulture,out var n)?n:0;
            return new SimCustomerSupplyLine(r.RowId ?? "index:"+r.Index,r.Index,r.Values.GetValueOrDefault("lineNumber")??"",
                r.CustomerIdentity?.PartNumber ?? r.PrimaryIdentity?.CustomerBomPartNumber ?? "",
                string.Join(" / ",SimApprovedPartIdentities.Resolve(r)),r.Values.GetValueOrDefault("description")??"",
                per,per*(facts.Lines.FirstOrDefault()?.Quantity??0),r.Values.GetValueOrDefault("unit")??"EA",
                material?.Quote.CustomerSupplied==true,baseline.Quote.QuoteNumber,poNumber,(documents??[]).Select(d=>d.Name).ToArray());
        }).ToArray();
    }
    internal static SimCustomerSupplyProjection Project(SimOrderTechnicalBaseline? baseline, SimOrderFacts facts,
        string poNumber, SimRfqIntakeDocument[] documents, SimCustomerSupplyReview? review)
    {
        var lines=Lines(baseline,facts,poNumber,documents);
        var token=Convert.ToHexString(SHA256.HashData(JsonSerializer.SerializeToUtf8Bytes(new {
            baseline?.SourceToken,baseline?.Quote,lines,facts,poNumber,
            documents=documents.OrderBy(d=>d.DocumentId).Select(d=>new{d.DocumentId,d.Name,d.Size})})));
        var selected=(review?.PoRowIds??[]).Distinct().Order().ToArray();
        var expected=lines.Where(l=>l.QuotedCustomerSupplied).Select(l=>l.SourceRowId).Order().ToArray();
        var issues=new List<string>();
        if(review is not null && selected.Any(id=>!lines.Any(l=>l.SourceRowId==id))) issues.Add("A PO C/S line is not in the retained BOM. Resolve the technical source.");
        if(review is not null && !selected.SequenceEqual(expected)) issues.Add("PO / quote C/S responsibility differs. Resolve with the customer and review the governing quote or technical package; neither source was overridden.");
        if(review is null || !review.Acknowledged || review.SourceToken!=token) issues.Add("Review and acknowledge C/S responsibility against the current PO, quote and job quantity.");
        return new(token,lines,selected,issues.Count==0,review?.Note??"",issues.ToArray());
    }
    internal static SimCustomerSupplyProjection Project(SimNewOrderPackage p) => Project(p.TechnicalSource?.Baseline,p.Facts,p.PoNumber,p.PoEvidence.Select(e=>e.Document).ToArray(),p.CustomerSupplyReview);
    internal static string Description(SimCustomerSupplyLine l) => $"{Label}; Find {l.FindNumber}; Customer P/N {l.CustomerPartNumber}; Approved P/N {l.ApprovedPartNumber}; {l.RequiredEach} {l.Uom}/assembly; minimum {l.RequiredQuantity} {l.Uom}; quote {l.QuoteNumber}; PO {l.PoNumber} ({string.Join(", ",l.PoDocumentNames)}). Supply responsibility only; receipt and kitting remain separate.";
}
