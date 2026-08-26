using Microsoft.Extensions.Logging;

var root = Path.Combine(Path.GetTempPath(), "dle-os-phase2-logging-" + Guid.NewGuid().ToString("N"));
Directory.CreateDirectory(root);
try
{
    for (var index = 0; index < 16; index++)
    {
        var path = Path.Combine(root, $"dev5054-20260101T0000{index:00}000Z-{Guid.NewGuid():N}.jsonl");
        File.WriteAllText(path, "{}\n");
        File.SetLastWriteTimeUtc(path, index == 0 ? DateTime.UtcNow.AddDays(-30) : DateTime.UtcNow.AddMinutes(-index));
    }

    using var provider = new DevJsonFileLoggerProvider(root, "dev5054-test", "source-test");
    var logger = provider.CreateLogger("Qualification");
    logger.LogInformation(new EventId(1, "RedactionTest"),
        "RedactionTest CorrelationId={CorrelationId} Password={Password} Token={Token}",
        "safe-correlation", "supersecret-password", "supersecret-token");

    var archivesAfterRetention = Directory.GetFiles(root, "dev5054-*.jsonl")
        .Where(path => !path.EndsWith("dev5054-current.jsonl", StringComparison.OrdinalIgnoreCase)).ToArray();
    if (archivesAfterRetention.Length > DevJsonFileLoggerProvider.MaximumArchiveFiles)
        throw new InvalidOperationException("Archive count retention failed.");
    if (archivesAfterRetention.Any(path => File.GetLastWriteTimeUtc(path) < DateTime.UtcNow.AddDays(-DevJsonFileLoggerProvider.RetentionDays)))
        throw new InvalidOperationException("Age retention failed.");

    var current = Path.Combine(root, "dev5054-current.jsonl");
    using (var stream = new FileStream(current, FileMode.OpenOrCreate, FileAccess.Write, FileShare.ReadWrite))
        stream.SetLength(DevJsonFileLoggerProvider.MaximumFileBytes);
    logger.LogInformation(new EventId(2, "RotationTest"), "RotationTest Result={Result}", "PASS");

    var allText = string.Join("\n", Directory.GetFiles(root, "dev5054-*.jsonl").Select(File.ReadAllText));
    if (allText.Contains("supersecret-password", StringComparison.Ordinal) ||
        allText.Contains("supersecret-token", StringComparison.Ordinal))
        throw new InvalidOperationException("Sensitive structured properties were not redacted.");
    if (!allText.Contains("[REDACTED]", StringComparison.Ordinal) ||
        !File.ReadAllText(current).Contains("RotationTest", StringComparison.Ordinal))
        throw new InvalidOperationException("Redaction or size rotation evidence is absent.");
    var total = Directory.GetFiles(root, "dev5054-*.jsonl").Sum(path => new FileInfo(path).Length);
    if (total > DevJsonFileLoggerProvider.MaximumTotalBytes)
        throw new InvalidOperationException("Total-size retention failed.");

    Console.WriteLine("PHASE2_LOGGING_QUALIFICATION_PASS");
}
finally
{
    if (Directory.Exists(root)) Directory.Delete(root, true);
}
