using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

internal sealed record SimWholeRowApproval(string ExpectedToken);
internal sealed record SimWholeRowAudit(string Reviewer, DateTimeOffset AtUtc, string PreviousToken);
internal sealed record SimRowReviewState(bool Reviewed, bool CanApprove, string[] Reasons, string[] ApprovalBlockers, string Token);

internal static class SimCandidateRowReview
{
    internal static bool HasConfirmedSubassemblyIdentity(SimCandidateRow row) =>
        row.IdentityBasis == "ASSEMBLY_PN" && (row.AssemblyIdentity is {PartNumber.Length: > 0, Reviewer.Length: > 0} || (row.Alternates ?? []).Any(a =>
            a.RemovedAtUtc is null && a.Origin == "MANUAL" && a.ReviewStatus == "CONFIRMED" &&
            !string.IsNullOrWhiteSpace(a.PartNumber) && a.History.LastOrDefault() is { ReviewStatus: "CONFIRMED" } h &&
            !string.IsNullOrWhiteSpace(h.Reviewer)));

    internal static SimRowReviewState Evaluate(SimCandidateRow row)
    {
        var reasons = new List<string>();
        var blockers = new List<string>();
        var selectedAlternate=SimApprovedAlternateChoices.Valid(row);
        if(row.SelectedApprovedAlternate is not null&&!selectedAlternate)blockers.Add("Selected alternate is stale, changed or no longer approved; choose a current Approved P/N.");
        if (row.ComponentType == "UNKNOWN") blockers.Add("Choose a component type before accepting this row.");
        if (row.SourcePartNumberReview?.Current.Status == "CONFIRMED" && !row.Confirmed)
            reasons.Add("Source P/N identity is confirmed; the whole row still requires Accept.");
        if (row.SourcePartNumberReview?.Current is { Status: "CONFIRMED", Basis: "MFG" } && row.ManufacturerIdentity is { } sourceIdentity &&
            sourceIdentity.Proposals.Any(p => sourceIdentity.Decision(p.Id) == "PROPOSED"))
            blockers.Add("Resolve pending manufacturer proposals individually before accepting this source identity.");
        if (row.SourcePartNumberReview?.Current.Status is "UNRESOLVED" or "INVALIDATED")
            blockers.Add("Source P/N basis is unresolved; confirm an identity before accepting.");
        if (row.SourcePartNumberReview?.Current.Status == "CONFIRMED" && !SimCandidateBomProvider.SourceIdentityMatches(row))
            blockers.Add("Source P/N identity changed; confirm it again before accepting.");
        if (SimCandidateBomProvider.Fields.Any(f => !row.Values.TryGetValue(f, out var v) || v is null || v.Length > 2000) ||
            !SimPreparation.LiteralFind(row,row.Values.GetValueOrDefault("lineNumber")) ||
            !SimCandidateBomProvider.ValidQuantity(row.Values.GetValueOrDefault("quantity"),row.ComponentType=="DNP" || SimRfqIntakeStore.LibraryOptionalZero(row)) ||
            (row.ComponentType!="DNP" && string.IsNullOrWhiteSpace(row.Values.GetValueOrDefault("partNumber"))))
            blockers.Add("Required BOM values are missing or invalid; correct them in details.");
        // A reviewed DLE build identity satisfies identity review for subassemblies only.
        // Keep the manufacturer evidence/stale flag intact; all other row and source guards still apply.
        if (row.IdentityBasis == "CUSTOMER_PN" && !SimCandidateBomProvider.HasCustomerIdentity(row))
            blockers.Add("Customer P/N identity is missing or changed; confirm it in Approved P/Ns.");
        if (!selectedAlternate && row.ComponentType!="DNP" && !HasConfirmedSubassemblyIdentity(row) && row.IdentityBasis != "CUSTOMER_PN" && row.ManufacturerIdentity is { } m)
        {
            if (m.Stale) blockers.Add("Manufacturer reconciliation is stale after a governing edit; rebuild/review the candidate.");
            if (m.Proposals.Any(p => m.Decision(p.Id) == "PROPOSED")) reasons.Add("Manufacturer identity proposals need review.");
            // An empty enrichment result is not a usable identity to approve blindly.
            if (!m.Proposals.Any(p => m.Decision(p.Id) != "REJECTED"))
                blockers.Add("Manufacturer identity is unresolved; inspect the source and resolve it in details.");
            if (m.Proposals.Where(p => m.Decision(p.Id) == "PROPOSED").Any(p => string.IsNullOrWhiteSpace(p.PartNumber) ||
                p.Confidence == "LOW" || p.Conflicts.Any(c => c != "description differs; governing value retained")))
                blockers.Add("A manufacturer proposal has conflicting or incomplete evidence; confirm/reject it individually in details.");
        }
        if ((row.Alternates ?? []).Any(a => a.RemovedAtUtc is null && a.ReviewStatus is not ("CONFIRMED" or "APPROVED" or "NOT_APPROVED")))
            blockers.Add("An alternate requires individual review in details.");
        if(row.ComponentType=="DNP"&&!row.Confirmed)reasons.Add("DNP disposition needs explicit row Accept.");
        if(row.WorkingState is not null) blockers.Add("Saved working changes need row Accept before completion.");
        var fieldsNeedReview = !row.Confirmed && (SimCandidateBomProvider.Fields.Any(f => !row.Comparison.TryGetValue(f, out var c) || c != "MATCH") ||
            (row.AnalysisFields?.Values.Any(f => HasUncertainty(f.Uncertainty)) ?? false));
        if (fieldsNeedReview) reasons.Add("Governing BOM fields have not been accepted as reviewed.");
        if (!row.Confirmed && (row.Comparison.Values.Any(c => c == "CONFLICT") ||
            (row.AnalysisFields?.Values.Any(f => HasUncertainty(f.Uncertainty) && f.Uncertainty.Trim() != "Source text preserved; human review required.") ?? false)))
            blockers.Add("Governing field conflict or specific uncertainty requires review/correction in details.");
        // Keep legacy/manual acceptance behavior for absent identities, while stale and pending identities always block.
        var completionBlockers = blockers.Where(b => b != "Manufacturer identity is unresolved; inspect the source and resolve it in details." || !row.Confirmed).ToArray();
        reasons.AddRange(completionBlockers);
        var tokenData = new { row.Index, row.Values, row.Extracted, row.Comparison, row.AnalysisFields, row.Confirmed, row.Reviewer,
            row.ReviewedAtUtc, row.Corrections, row.ManufacturerIdentity, row.Alternates, row.AlternateRevision,
            row.ComponentType, row.ComponentTypeRevision, row.WholeRowHistory, row.AssemblyIdentity, row.AssemblyIdentityHistory };
        var tokenNode=JsonSerializer.SerializeToNode(tokenData)!;
        if(row.SelectedApprovedAlternate is not null)tokenNode["SelectedApprovedAlternate"]=JsonSerializer.SerializeToNode(row.SelectedApprovedAlternate);
        if(row.ApprovedAlternateSelectionHistory is not null)tokenNode["ApprovedAlternateSelectionHistory"]=JsonSerializer.SerializeToNode(row.ApprovedAlternateSelectionHistory);
        if(row.PrimaryIdentity is not null)tokenNode["PrimaryIdentity"]=JsonSerializer.SerializeToNode(row.PrimaryIdentity);
        if(row.SourcePartNumberReview is not null)tokenNode["SourcePartNumberReview"]=JsonSerializer.SerializeToNode(row.SourcePartNumberReview);
        if(row.ComponentType=="DNP"&&!row.Confirmed)reasons.Add("DNP disposition needs explicit row Accept.");
        if(row.WorkingState is not null)tokenNode["WorkingState"]=JsonSerializer.SerializeToNode(row.WorkingState);
        var token = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(Canonical(tokenNode)!.ToJsonString()))).ToLowerInvariant();
        return new(reasons.Count == 0, reasons.Count != 0 && blockers.Count == 0, reasons.Distinct().ToArray(), blockers.Distinct().ToArray(), token);
    }
    private static bool HasUncertainty(string? text) => !string.IsNullOrWhiteSpace(text) && !Regex.IsMatch(text.Trim(), "^none[.!]?$", RegexOptions.IgnoreCase);
    private static JsonNode? Canonical(JsonNode? node, string field = "")
    {
        if (node is JsonObject obj) return new JsonObject(obj.OrderBy(p=>p.Key,StringComparer.Ordinal).Select(p=>KeyValuePair.Create(p.Key,Canonical(p.Value,p.Key))));
        if (node is JsonArray array) return new JsonArray(array.Select(n=>Canonical(n)).ToArray());
        if (field.EndsWith("Utc",StringComparison.OrdinalIgnoreCase) && node is JsonValue value && value.TryGetValue<string>(out var text) && DateTimeOffset.TryParse(text,out var time))
            return JsonValue.Create(time.UtcDateTime.ToString("O",CultureInfo.InvariantCulture));
        return node?.DeepClone();
    }
}
