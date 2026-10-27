using System.Security.Cryptography;
using Microsoft.VisualBasic.FileIO;

internal sealed record SimAssemblyHeader(string SourceKeyRaw, string SourceRecordHash, string ContractVersion,
    string BillNumber, string DrawingNumber, string DrawingRevision, string BomRevisionDate, string BomRevision,
    bool NormalizedKeyCollision);

// Historical, read-only headers; deliberately separate from candidate/approved BOM storage.
internal static class SimAssemblyLibrarySnapshot
{
    internal const string RunId = "LIVEMIRROR001-20260729T232139Z-7CAB3382";
    internal const string CsvHash = "B84A6BB4FE45D10C61DFC4E5CB3C60E0D8E0DC239E8B00A23027D53B06F3CBC8";
    internal static SimAssemblyHeader[] Read(string path)
    {
        var bytes = File.ReadAllBytes(path);
        if (bytes.Length != 222011 || Convert.ToHexString(SHA256.HashData(bytes)) != CsvHash)
            throw new InvalidDataException("Preliminary snapshot verification failed.");
        using var reader = new StringReader(System.Text.Encoding.UTF8.GetString(bytes).TrimStart('\uFEFF'));
        using var csv = new TextFieldParser(reader) { TextFieldType = FieldType.Delimited,
            HasFieldsEnclosedInQuotes = true, TrimWhiteSpace = false };
        csv.SetDelimiters(",");
        string[] columns = ["SourceKeyRaw", "SourceRecordHash", "ContractVersion", "BillNumber", "DrawingNumber", "DrawingRevision", "BomRevisionDate", "BomRevision"];
        if (!(csv.ReadFields() ?? []).SequenceEqual(columns)) throw new InvalidDataException("Unexpected header schema.");
        var rows = new List<SimAssemblyHeader>();
        while (!csv.EndOfData) {
            var f = csv.ReadFields()!;
            if (f.Length != columns.Length) throw new InvalidDataException("Unexpected header fields.");
            rows.Add(new(f[0],f[1],f[2],f[3],f[4],f[5],f[6],f[7],false));
        }
        if (rows.Count != 1290 || rows.Select(r => r.SourceKeyRaw).Distinct(StringComparer.Ordinal).Count() != 1290 ||
            rows.Count(r => r.DrawingNumber.TrimEnd().Length == 0) != 493)
            throw new InvalidDataException("Unexpected snapshot counts.");
        var collisions = rows.GroupBy(r => r.BillNumber.Trim(), StringComparer.Ordinal)
            .Where(g => g.Count() > 1).Select(g => g.Key).ToHashSet(StringComparer.Ordinal);
        return rows.Select(r => r with { NormalizedKeyCollision = collisions.Contains(r.BillNumber.Trim()) }).ToArray();
    }
}
