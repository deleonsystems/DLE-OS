using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

internal sealed record SimPoField(string Value, int Page, string Evidence, string Confidence, string? DocumentId = null, string? Sha256 = null);
internal sealed record SimParsedPo(string Status, Dictionary<string, SimPoField> Fields);
internal sealed record SimPoExtraction(string Status, string DocumentToken, Dictionary<string, SimPoField> Fields, SimOrderFacts Facts, string ParserVersion = "LOCAL_PO_TEXT_V1");
internal sealed record SimPoExtractRequest(string CorrelationId, string? IntakeId, SimRfqIntakeDocument[] Documents);
internal sealed record SimPoFactReview(SimPoExtraction Extraction, SimOrderFacts ConfirmedFacts, string PoNumber, string CustomerId,
    string[] Corrections, string ReviewerId, string Reviewer, DateTimeOffset At, string DecisionHash);

internal sealed partial class SimRfqIntakeStore
{
    private static string PoDocumentToken(IEnumerable<SimOrderEvidence> evidence) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(
        string.Join("|", evidence.OrderBy(e=>e.Document.DocumentId).Select(e=>e.Document.DocumentId+":"+e.Sha256)))));

    private async Task<SimPoExtraction> ParseOrderPo(string correlation, SimOrderEvidence[] evidence)
    {
        var fields = new Dictionary<string, SimPoField>(); var conflicts = new HashSet<string>();
        foreach (var e in evidence) {
            var parsed = await SimPoParser.Inspect(await documents.Bytes(correlation,e.Document.DocumentId!));
            foreach (var pair in parsed.Fields) {
                if (pair.Key is "poDate" or "customerDueDate") continue;
                if (fields.TryGetValue(pair.Key, out var prior) && prior.Value != pair.Value.Value) conflicts.Add(pair.Key);
                else fields[pair.Key] = pair.Value with { DocumentId=e.Document.DocumentId, Sha256=e.Sha256 };
            }
        }
        foreach (var key in conflicts) fields.Remove(key);
        string? V(string key) => fields.GetValueOrDefault(key)?.Value;
        decimal? D(string key) => decimal.TryParse(V(key),NumberStyles.AllowDecimalPoint,CultureInfo.InvariantCulture,out var n) ? n : null;
        int? quantity = int.TryParse(V("quantity"),out var q) && q>0 ? q : null;
        var facts = new SimOrderFacts(null,[new(V("assembly")??"",V("revision")??"",quantity,V("currency")??"",D("unitPrice"),D("extendedValue"))],V("requestedDelivery"),D("nre"),D("separateCharges"));
        return new(fields.Count>0 ? "SUGGESTED" : "UNAVAILABLE",PoDocumentToken(evidence),fields,facts);
    }
    internal async Task<SimPoExtraction> ExtractOrderPo(SimPoExtractRequest request, SimPersona persona)
    {
        await gate.WaitAsync();
        try {
            if (request.Documents is not {Length: >0 and <=10} || request.Documents.Any(d=>d.DocumentId is null) || request.Documents.Select(d=>d.DocumentId).Distinct().Count()!=request.Documents.Length)
                throw SimRfqIntakeProblem.BadRequest("ORDER_PO_EXTRACT", "Select verified customer PO evidence (up to ten files).");
            var record = (await ReadDatasetAsync()).Records.SingleOrDefault(r=>r.IntakeId==request.IntakeId && r.IntakeType=="NEW_ORDER" && r.Environment=="SIM");
            if (request.IntakeId is not null && (record is null || record.RequestCorrelationId != request.CorrelationId))
                throw SimRfqIntakeProblem.Conflict("ORDER_PO_EXTRACT", "Reopen the saved order before extracting its evidence.");
            var evidence = new List<SimOrderEvidence>();
            foreach (var doc in request.Documents) {
                var prior = record?.OrderIntake?.PoEvidence.SingleOrDefault(e=>e.Document.DocumentId==doc.DocumentId);
                var owner = prior?.AddedBy ?? persona.DisplayName;
                var verified = await documents.Verify(request.CorrelationId,doc,owner);
                evidence.Add(new(verified,Convert.ToHexString(SHA256.HashData(await documents.Bytes(request.CorrelationId,doc.DocumentId!))),owner));
            }
            return await ParseOrderPo(request.CorrelationId,evidence.ToArray());
        } finally { gate.Release(); }
    }
    private static Dictionary<string,string?> PoFactValues(SimOrderFacts f) {
        var l=f.Lines.FirstOrDefault(); string? N(decimal? v)=>v?.ToString(CultureInfo.InvariantCulture);
        return new() { ["poDate"]=f.PoDate,["assembly"]=l?.Assembly,["revision"]=l?.Revision,["quantity"]=l?.Quantity?.ToString(CultureInfo.InvariantCulture),["currency"]=l?.Currency,["unitPrice"]=N(l?.UnitPrice),["extendedValue"]=N(l?.ExtendedValue),["nre"]=N(f.Nre),["separateCharges"]=N(f.SeparateCharges),["requestedDelivery"]=f.RequestedDelivery };
    }
}
