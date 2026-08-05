var root = Path.Combine(Path.GetTempPath(), "DleOsKittingDocumentTests", Guid.NewGuid().ToString("N"));
var shortage = Path.Combine(root, "KIT-SHORTAGES");
var complete = Path.Combine(root, "KIT-COMPLETE");
Directory.CreateDirectory(shortage);
Directory.CreateDirectory(complete);

try
{
    var service = new KittingDocumentService(shortage, complete);

    WritePdf(Path.Combine(complete, "0115586.pdf"));
    AssertEvidence(service.GetEvidence("0115586"), "KIT_COMPLETE_EVIDENCE", "0115586.pdf", null);
    File.Delete(Path.Combine(complete, "0115586.pdf"));

    WritePdf(Path.Combine(shortage, "115586.pdf"));
    AssertEvidence(service.GetEvidence("0115586"), "KIT_SHORT_EVIDENCE", "115586.pdf", null);

    WritePdf(Path.Combine(complete, "115586.pdf"));
    AssertEvidence(service.GetEvidence("0115586"), "KIT_COMPLETE_WITH_PRIOR_SHORTAGE_EVIDENCE", "115586.pdf", "115586.pdf");
    Assert(service.GetEvidence("0115586").Primary?.Kind == KittingDocumentKind.Complete,
        "Complete must be primary when both documents exist.");
    Assert(service.ResolveDocumentPath("0115586", "shortage")?.EndsWith("115586.pdf", StringComparison.OrdinalIgnoreCase) == true,
        "Prior-shortage document must be independently resolvable.");

    AssertEvidence(service.GetEvidence("0999999"), "NO_KITTED_BOM_EVIDENCE", null, null);
    Assert(service.ResolveDocumentPath("0999999", "complete") is null, "Missing documents must resolve as not found.");
    Assert(KittingDocumentService.NormalizeWorkOrder("0115586").Aliases.SequenceEqual(new[] { "0115586", "115586" }),
        "Canonical and leading-zero-trimmed aliases must be generated in controlled order.");
    Assert(KittingDocumentService.NormalizeWorkOrder("115586").Aliases.SequenceEqual(new[] { "115586" }),
        "A six-digit canonical value must not create a duplicate alias.");

    foreach (var invalid in new[] { "", " ", "0115586.pdf", "../0115586", "..\\0115586", "P:\\KITTING\\115586", "11/5586", "11a5586" })
        AssertThrows(() => service.GetEvidence(invalid), $"Invalid Work Order input must be rejected: {invalid}");
    foreach (var invalidType in new[] { "pdf", "complete.pdf", "../complete", "P:\\KITTING", "", "other" })
        AssertThrows(() => service.ResolveDocumentPath("0115586", invalidType), $"Invalid document type must be rejected: {invalidType}");

    Assert(service.ResolveDocumentPath("0115586", "complete")!.StartsWith(complete, StringComparison.OrdinalIgnoreCase),
        "Complete resolution must remain under its approved root.");
    Assert(service.ResolveDocumentPath("0115586", "shortage")!.StartsWith(shortage, StringComparison.OrdinalIgnoreCase),
        "Shortage resolution must remain under its approved root.");

    Console.WriteLine("PASS: 24 Kitted BOM lookup, classification, alias, not-found, and boundary assertions.");
}
finally
{
    Directory.Delete(root, recursive: true);
}

static void WritePdf(string path) => File.WriteAllBytes(path, "%PDF-1.4\n%%EOF"u8.ToArray());

static void AssertEvidence(KittingEvidence evidence, string status, string? primaryFile, string? secondaryFile)
{
    Assert(evidence.EvidenceStatus == status, $"Expected {status}, got {evidence.EvidenceStatus}.");
    Assert(evidence.Primary?.FileName == primaryFile, $"Unexpected primary document for {status}.");
    Assert(evidence.SecondaryPriorShortage?.FileName == secondaryFile, $"Unexpected secondary document for {status}.");
}

static void AssertThrows(Action action, string message)
{
    try { action(); }
    catch (KittingDocumentValidationException) { return; }
    throw new InvalidOperationException(message);
}

static void Assert(bool condition, string message)
{
    if (!condition) throw new InvalidOperationException(message);
}
