// One read-only projection of retained approved identities; never infer approval from source text.
internal static class SimApprovedPartIdentities
{
    internal static string[] Resolve(SimCandidateRow row)
    {
        if (row.ComponentType == "DNP") return [];
        var numbers = new List<string>();
        if(SimApprovedAlternateChoices.Valid(row))numbers.Add(row.SelectedApprovedAlternate!.PartNumber!);
        if (row.IdentityBasis == "ASSEMBLY_PN")
        {
            if (!string.IsNullOrWhiteSpace(row.AssemblyIdentity?.PartNumber)) numbers.Add(row.AssemblyIdentity.PartNumber);
            else numbers.AddRange((row.Alternates ?? []).Where(a => a.RemovedAtUtc is null && a.Origin == "MANUAL" &&
                a.ReviewStatus == "CONFIRMED" && a.History.LastOrDefault() is { ReviewStatus: "CONFIRMED" } h &&
                !string.IsNullOrWhiteSpace(h.Reviewer)).Select(a => a.PartNumber));
        }
        else if (row.IdentityBasis == "CUSTOMER_PN" && !string.IsNullOrWhiteSpace(row.PrimaryIdentity?.PartNumber))
            numbers.Add(row.PrimaryIdentity.PartNumber);
        else if (row.IdentityBasis == "MANUFACTURER_PN" && row.ManufacturerIdentity is { Stale: false } manufacturer)
        {
            // Every included proposal was individually confirmed and the complete row accepted.
            // Keep all explicit approved identities; no description or naming heuristic is used.
            numbers.AddRange(manufacturer.Proposals.Where(p => manufacturer.Decision(p.Id) == "CONFIRMED").Select(p => p.PartNumber));
        }
        if (numbers.Count == 0) return [];
        numbers.AddRange((row.Alternates ?? []).Where(a => a.RemovedAtUtc is null && a.ReviewStatus == "APPROVED").Select(a => a.PartNumber));
        return numbers.Where(n => !string.IsNullOrWhiteSpace(n)).Distinct(StringComparer.Ordinal).ToArray();
    }

}
