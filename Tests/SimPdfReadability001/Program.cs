using System.Text.Json;
using System.Diagnostics;

// Inputs are local PDFs: text-readable, scanned, mixed. All writes use disposable state.
void Check(bool ok, string message) { if (!ok) throw new Exception(message); Console.WriteLine("PASS: " + message); }
var root = Path.Combine(Path.GetTempPath(), "dle-readability-tests-" + Guid.NewGuid().ToString("N"));
var staging = new SimIntakeDocuments(root);
var store = new SimRfqIntakeStore(root);
var persona = new SimPersona("test", "test", "Readability Test", "ACTIVE", [], [], true, "SIM");
var statuses = new[] { "TEXT_READABLE", "IMAGE_ONLY", "MIXED" };
for (var i = 0; i < 3; i++)
{
    var bytes = await File.ReadAllBytesAsync(args[i]);
    var clock = Stopwatch.StartNew();
    var result = await SimPdfReadability.Inspect(bytes);
    Check(result.Status == statuses[i], statuses[i] + " classified in " + clock.ElapsedMilliseconds + " ms");
    var draft = Guid.NewGuid().ToString("D");
    var staged = await staging.Stage(draft, "fixture.pdf", 1, new MemoryStream(bytes), persona.DisplayName);
    Check(staged.Readability == result, "staged result matches inspection");
    var forged = staged with { Readability = new("UNKNOWN") };
    var now = DateTimeOffset.UtcNow;
    var metadata = new SimStateMetadata("SIM", "test", 1, 1, 1, now, now, 1, now, 1, 0, 1);
    await store.CreateAsync(new("NEW_QUOTE_REQUEST", new("test", "test", "Test", "sim-canonical-customer-directory"),
        1, [new(1, "TEST", "A", 1)], "MATERIAL_AND_LABOR", true, [forged], ["PRICE", "LEAD_TIME"], persona.DisplayName, draft), persona, metadata);
    var reopened = new SimRfqIntakeStore(root);
    var review = JsonSerializer.SerializeToElement(await reopened.ReadTechnicalReviewAsync($"RFQI-SIM-{i+1:0000}"), new JsonSerializerOptions(JsonSerializerDefaults.Web));
    Check(review.GetProperty("record").GetProperty("technicalFiles")[0].GetProperty("readability").GetProperty("status").GetString() == statuses[i], "submit/reopen/Technical Review retains authoritative metadata");
    Check((await staging.Bytes(draft, staged.DocumentId!)).SequenceEqual(bytes), "binary preserved exactly");
}
var nonPdf = await staging.Stage(Guid.NewGuid().ToString("D"), "notes.txt", 0, new MemoryStream("notes"u8.ToArray()), persona.DisplayName);
Check(nonPdf.Readability is null, "non-PDF unaffected");
var broken = await staging.Stage(Guid.NewGuid().ToString("D"), "broken.pdf", 0, new MemoryStream("%PDF-invalid"u8.ToArray()), persona.DisplayName);
Check(broken.BinaryStatus == "VERIFIED" && broken.Readability?.Status == "UNKNOWN", "invalid PDF check does not block staging or label it scanned");
Environment.SetEnvironmentVariable("DLE_OS_SIM_BOM_PYTHON", Path.Combine(root, "missing-python.exe"));
Check((await SimPdfReadability.Inspect(await File.ReadAllBytesAsync(args[0]))).Status == "UNKNOWN", "missing dependency is nonblocking UNKNOWN");
Console.WriteLine("Disposable test state: " + root);
