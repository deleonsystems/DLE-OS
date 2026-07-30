using System.Reflection;
using System.Text.Json;
using DLE_OS_Server.Options;

var assembly = typeof(LiveApiOptions).Assembly;
var repositoryType = assembly.GetType(
    "DLE_OS_Server.Data.Platform.Live.LivePlatformStatusRepository",
    throwOnError: true)!;
var rowType = assembly.GetType(
    "DLE_OS_Server.Models.Platform.LiveSnapshotRow",
    throwOnError: true)!;
var evaluate = repositoryType.GetMethod(
    "Evaluate",
    BindingFlags.NonPublic | BindingFlags.Static)
    ?? throw new InvalidOperationException(
        "Readiness evaluation method was not found.");

const string mirrorRunId = "MIRROR-QUALIFIED";
var importRunId = Guid.Parse("27f0ed25-adcc-46aa-96f4-f0cc7d6ae8b6");
var options = new LiveApiOptions
{
    DataEnvironment = "LIVE",
    Database = "DLE_OS_CANONICAL_LIVE",
    StoredContractVersion = "V1.2",
    ExpectedImportRunId = importRunId,
    ExpectedMirrorRunId = mirrorRunId,
    ExpectedPackageHash = new string('A', 64),
    ExpectedBillOfMaterialCount = 1290,
    ExpectedInventoryItemCount = 28662,
    ExpectedWorkOrderCount = 12113,
    ExpectedGeneralLedgerAccountCount = 257,
    SnapshotWarningMinutes = 1440,
    SourceCheckWarningMinutes = 1440,
    SourceCheckHardExpirationMinutes = 4320,
    QualificationWarningMinutes = 10080
};

object NewRow(
    long snapshotAgeSeconds,
    long sourceCheckAgeSeconds,
    long qualificationAgeSeconds = 3600,
    string sourceChangeStatus = "Unchanged",
    string? packageHash = null)
{
    var row = Activator.CreateInstance(rowType, nonPublic: true)
        ?? throw new InvalidOperationException("Could not create row.");
    var values = new Dictionary<string, object>
    {
        ["ImportRunId"] = importRunId,
        ["EnvironmentId"] = "LIVE",
        ["MirrorRunId"] = mirrorRunId,
        ["PackageHash"] = packageHash ?? new string('A', 64),
        ["ContractVersion"] = "V1.2",
        ["SnapshotTimestampUtc"] =
            DateTime.UtcNow.AddSeconds(-snapshotAgeSeconds),
        ["SnapshotAgeSeconds"] = snapshotAgeSeconds,
        ["SourceCheckedAtUtc"] =
            DateTime.UtcNow.AddSeconds(-sourceCheckAgeSeconds),
        ["SourceCheckAgeSeconds"] = sourceCheckAgeSeconds,
        ["QualificationCompletedAtUtc"] =
            DateTime.UtcNow.AddSeconds(-qualificationAgeSeconds),
        ["QualificationAgeSeconds"] = qualificationAgeSeconds,
        ["LastSourceCheckResult"] = "NO_SOURCE_CHANGES",
        ["SourceChangeStatus"] = sourceChangeStatus,
        ["SourceIndicatorFingerprint"] = new string('B', 64),
        ["LastFullExtractionRunId"] = "LIVEREFRESH-QUALIFIED",
        ["LastForceFullIntent"] = false,
        ["BillOfMaterialCount"] = 1290L,
        ["InventoryItemCount"] = 28662L,
        ["WorkOrderCount"] = 12113L,
        ["GeneralLedgerAccountCount"] = 257L,
        ["TotalCount"] = 42322L
    };
    foreach (var pair in values)
    {
        rowType.GetProperty(pair.Key)!.SetValue(row, pair.Value);
    }
    return row;
}

(string Verdict, string State, int Warnings, int HardFailures) Evaluate(
    object row)
{
    var result = evaluate.Invoke(null, [row, options])
        ?? throw new InvalidOperationException("Evaluation returned null.");
    var type = result.GetType();
    return (
        (string)type.GetProperty("Verdict")!.GetValue(result)!,
        (string)type.GetProperty("State")!.GetValue(result)!,
        ((System.Collections.ICollection)
            type.GetProperty("Warnings")!.GetValue(result)!).Count,
        ((System.Collections.ICollection)
            type.GetProperty("HardFailures")!.GetValue(result)!).Count);
}

var cases = new[]
{
    ("Fresh", NewRow(3600, 3600), "Ready", "ReadyFresh"),
    (
        "Old snapshot recently source checked",
        NewRow(172800, 3600),
        "Ready",
        "ReadySourceRechecked"
    ),
    (
        "Warning-only source check age",
        NewRow(172800, 172800),
        "Ready",
        "ReadyWithStaleSnapshotWarning"
    ),
    (
        "Source check hard expiration",
        NewRow(172800, 345600),
        "NotReady",
        "NotReadySourceCheckExpired"
    ),
    (
        "Source changed",
        NewRow(3600, 3600, sourceChangeStatus: "Changed"),
        "NotReady",
        "NotReadySourceChanged"
    ),
    (
        "Package mismatch",
        NewRow(3600, 3600, packageHash: new string('C', 64)),
        "NotReady",
        "NotReadyPackageMismatch"
    )
};

var results = cases.Select(test =>
{
    var actual = Evaluate(test.Item2);
    if (actual.Verdict != test.Item3 || actual.State != test.Item4)
    {
        throw new InvalidOperationException(
            $"{test.Item1}: expected {test.Item3}/{test.Item4}, " +
            $"actual {actual.Verdict}/{actual.State}.");
    }
    return new
    {
        Name = test.Item1,
        actual.Verdict,
        actual.State,
        actual.Warnings,
        actual.HardFailures
    };
}).ToArray();

Console.WriteLine(JsonSerializer.Serialize(
    new
    {
        Verdict = "PASS",
        AssertionsPassed = results.Length,
        Cases = results
    },
    new JsonSerializerOptions { WriteIndented = true }));
