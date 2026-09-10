internal sealed record SimAssemblyBuild(string RecordId, string Revision, string BuiltAt, int Quantity);

internal sealed record SimAssemblyHistoryQuestion(
    string AssemblyNumber, string CustomerNumber, bool LookupCompleted, bool HistoryFound,
    string[] RevisionsFound, string? MostRecentRevision, SimAssemblyBuild[] Records,
    string LookupSource, bool Synthetic, DateTimeOffset LookedUpAtUtc,
    string? AssemblyClassification = null, string? ConfirmedBy = null, DateTimeOffset? ConfirmedAtUtc = null);

internal sealed record SimAssemblyClassificationRequest(string? AssemblyClassification);

// Deliberately independent of DEV/LIVE invoice history. Exact matching follows RFQ history conventions.
internal static class SimAssemblyHistoryProvider
{
    internal static SimAssemblyHistoryQuestion Lookup(SimRfqIntakeRecord intake)
    {
        var assembly = intake.Assemblies.OrderBy(item => item.LineNumber).First().AssemblyNumber.Trim().ToUpperInvariant();
        var customer = intake.Customer.CustomerNumber.Trim();
        if (customer.All(char.IsDigit)) customer = customer.PadLeft(6, '0');
        SimAssemblyBuild[] records = customer == "990100" && assembly == "B11283-17"
            ? [new("SIM-BUILD-ABBOTT-002", "B", "2026-08-18", 25),
               new("SIM-BUILD-ABBOTT-001", "A", "2026-04-09", 20)]
            : [];
        return new(assembly, customer, true, records.Length > 0,
            records.Reverse().Select(item => item.Revision).Distinct().ToArray(),
            records.FirstOrDefault()?.Revision, records, "SIM_SYNTHETIC_ASSEMBLY_HISTORY_V1", true, DateTimeOffset.UtcNow);
    }
}
