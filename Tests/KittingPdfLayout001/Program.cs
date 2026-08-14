using System.Security.Cryptography;
using System.Text.Json;

if (args.Length != 1 || !Directory.Exists(args[0]))
    throw new ArgumentException("Pass the fixture directory.");

foreach (var jsonPath in Directory.GetFiles(args[0], "*_LAYOUT-PREVIEW.json"))
{
    var snapshot = await File.ReadAllTextAsync(jsonPath);
    using var document = JsonDocument.Parse(snapshot);
    if (!document.RootElement.TryGetProperty("draft", out _))
        throw new InvalidDataException($"{jsonPath} is not an immutable submission snapshot.");
    var pdf = KittingCasePdfWriter.Create(snapshot);
    var pdfText = System.Text.Encoding.ASCII.GetString(pdf);
    foreach (var requiredToken in new[] { "P.O. TRACEABILITY", "NOT RECORDED", "PICKED", "COUNT / ALLOCATION DETAIL", "P.O. PO-QA-MAIN" })
        if (!pdfText.Contains(requiredToken, StringComparison.Ordinal))
            throw new InvalidDataException($"{jsonPath} is missing presentation token: {requiredToken}");
    if (Path.GetFileName(jsonPath).Contains("KIT-SHORT", StringComparison.Ordinal) && !pdfText.Contains("SHORT ", StringComparison.Ordinal))
        throw new InvalidDataException($"{jsonPath} does not identify the remaining shortage.");
    var currentSnapshot = System.Text.Json.Nodes.JsonNode.Parse(snapshot)!.AsObject();
    currentSnapshot["poTraceabilityRequired"] = true;
    if (!System.Text.Encoding.ASCII.GetString(KittingCasePdfWriter.Create(currentSnapshot.ToJsonString())).Contains("REQUIRED", StringComparison.Ordinal))
        throw new InvalidDataException("A current REQUIRED snapshot does not render its traceability mode.");
    currentSnapshot["poTraceabilityRequired"] = false;
    if (!System.Text.Encoding.ASCII.GetString(KittingCasePdfWriter.Create(currentSnapshot.ToJsonString())).Contains("OPTIONAL", StringComparison.Ordinal))
        throw new InvalidDataException("A current OPTIONAL snapshot does not render its traceability mode.");
    var pdfPath = Path.ChangeExtension(jsonPath, ".pdf");
    await File.WriteAllBytesAsync(pdfPath, pdf);
    Console.WriteLine($"{Path.GetFileName(pdfPath)} | {pdf.Length} bytes | {Convert.ToHexString(SHA256.HashData(pdf))}");
}
