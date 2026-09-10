internal sealed record SimBomLine(string PartNumber, decimal QuantityPerAssembly, bool IsSubassembly = false, string? TechnicalReference = null);
internal sealed record SimBom(string Source, string Reference, string AssemblyNumber, string Revision, SimBomLine[] Lines, string? SourceKind = null);
internal sealed record SimBomQuantityChange(string PartNumber, decimal PriorQuantity, decimal CurrentQuantity);
internal sealed record SimMaterialsDefinition(
    bool CurrentBomIdentified, bool PriorBomIdentified, bool ComparisonCompleted,
    SimBom? CurrentBom, SimBom? PriorBom, bool ParentAssemblyMatch, bool RevisionMatch,
    int CurrentLineCount, int PriorLineCount, string[] UnchangedParts, string[] AddedParts, string[] RemovedParts,
    SimBomQuantityChange[] QuantityChanges, SimBomLine[] Subassemblies,
    string Result, string Source, bool Synthetic, string ReviewedBy, DateTimeOffset ReviewedAtUtc);

internal static class SimMaterialsDefinitionProvider
{
    internal static SimMaterialsDefinition Compare(SimRfqIntakeRecord record, SimPersona persona)
    {
        var assembly = record.Assemblies.OrderBy(item => item.LineNumber).First();
        if (record.Customer.CustomerNumber.Trim().PadLeft(6, '0') != "990100" ||
            !assembly.AssemblyNumber.Trim().Equals("B11283-17", StringComparison.OrdinalIgnoreCase) ||
            !assembly.Revision.Trim().Equals("B", StringComparison.OrdinalIgnoreCase))
            throw SimRfqIntakeProblem.Conflict("DLE_OS_SIM_BOM_FIXTURE_UNAVAILABLE", "No synthetic BOM fixture is available for this customer, assembly and revision.");

        // Metadata association only: no source files are opened or interpreted as ERP BOMs.
        var package = record.TechnicalReview?.TechnicalPackage;
        var document = package?.Documents.SingleOrDefault(doc => doc.DocumentId == package.GoverningBomDocumentId && SimTechnicalPackageProvider.IsBomSource(doc) && doc.Applicability == "PARENT_ASSEMBLY");
        if (document is null) throw SimRfqIntakeProblem.Conflict("DLE_OS_SIM_GOVERNING_BOM_REQUIRED", "Select the governing parent BOM from the classified package before comparing materials.");
        var different = document?.Name.Equals("SIM-BOM-DIFFERENCES.csv", StringComparison.OrdinalIgnoreCase) == true;
        SimBomLine[] priorLines = [new("R-100", 2), new("C-10", 1), new("SUB-CONTROLLER", 1, true, "SIM-PACKAGE-SUB-CONTROLLER-B")];
        var prior = new SimBom("Prior DLE Rev B build", "SIM-BUILD-ABBOTT-002 / SIM-BOM-REV-B", "B11283-17", "B", priorLines);
        var current = document is null ? null : new SimBom("Current customer technical package", document.Name, assembly.AssemblyNumber.Trim(), assembly.Revision.Trim(),
            different ? [new("R-100", 3), new("LED-20", 1), new("SUB-CONTROLLER", 1, true)] : priorLines.ToArray(), SimTechnicalPackageProvider.SourceKind(document));
        var currentLines = current?.Lines ?? [];
        var added = currentLines.Where(line => !priorLines.Any(old => old.PartNumber == line.PartNumber)).Select(line => line.PartNumber).ToArray();
        var removed = current is null ? [] : priorLines.Where(line => !currentLines.Any(now => now.PartNumber == line.PartNumber)).Select(line => line.PartNumber).ToArray();
        var changes = currentLines.Join(priorLines, line => line.PartNumber, line => line.PartNumber,
            (now, old) => new SimBomQuantityChange(now.PartNumber, old.QuantityPerAssembly, now.QuantityPerAssembly)).Where(line => line.PriorQuantity != line.CurrentQuantity).ToArray();
        var unchanged = currentLines.Where(now => priorLines.Any(old => old.PartNumber == now.PartNumber && old.QuantityPerAssembly == now.QuantityPerAssembly)).Select(line => line.PartNumber).ToArray();
        var subs = currentLines.Where(line => line.IsSubassembly).ToArray();
        var parentMatch = current?.AssemblyNumber.Equals(prior.AssemblyNumber, StringComparison.OrdinalIgnoreCase) == true;
        var revMatch = current?.Revision.Equals(prior.Revision, StringComparison.OrdinalIgnoreCase) == true;
        var result = current is null ? "NEEDS_INFORMATION" : !parentMatch || !revMatch || added.Length > 0 || removed.Length > 0 || changes.Length > 0 || subs.Any(line => line.TechnicalReference is null)
            ? "DIFFERENCES_FOUND" : "LOOKS_CONSISTENT";
        return new(current is not null, true, current is not null, current, prior, parentMatch, revMatch,
            currentLines.Length, priorLines.Length, unchanged, added, removed, changes, subs, result,
            "SIM_SYNTHETIC_MATERIALS_DEFINITION_V1", true, persona.DisplayName, DateTimeOffset.UtcNow);
    }
}
