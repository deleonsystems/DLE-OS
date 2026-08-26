using System.Text.Json;
using Microsoft.Extensions.Logging;

internal sealed class Dev5054ServiceProcessState
{
    public string Schema { get; init; } = "dle-os.dev5054-service-process-state.v1";
    public string ServiceName { get; init; } = "";
    public string ReleaseId { get; init; } = "";
    public string SourceIdentity { get; init; } = "";
    public int ProcessId { get; init; }
    public DateTimeOffset StartedUtc { get; init; }
    public DateTimeOffset? GracefulStopRecordedUtc { get; init; }
}

internal static class Dev5054ServiceRecoveryEvidence
{
    private const string StateFileName = "dev5054-service-process-state.json";

    internal static void RecordStartup(
        ILogger logger,
        string logRoot,
        string serviceName,
        string releaseId,
        string sourceIdentity)
    {
        var path = GetStatePath(logRoot);
        if (File.Exists(path))
        {
            var previous = JsonSerializer.Deserialize<Dev5054ServiceProcessState>(File.ReadAllText(path));
            if (previous is not null && previous.ProcessId > 0 && previous.GracefulStopRecordedUtc is null)
                logger.LogWarning(new EventId(1005, "PreviousServiceProcessExitedUnexpectedly"),
                    "PreviousServiceProcessExitedUnexpectedly PreviousProcessId={PreviousProcessId} PreviousReleaseId={PreviousReleaseId} PreviousStartedUtc={PreviousStartedUtc}",
                    previous.ProcessId, previous.ReleaseId, previous.StartedUtc);
        }

        WriteState(path, new Dev5054ServiceProcessState
        {
            ServiceName = serviceName,
            ReleaseId = releaseId,
            SourceIdentity = sourceIdentity,
            ProcessId = Environment.ProcessId,
            StartedUtc = DateTimeOffset.UtcNow
        });
        logger.LogInformation(new EventId(1006, "ServiceProcessStateRecorded"),
            "ServiceProcessStateRecorded ServiceName={ServiceName} ReleaseId={ReleaseId} ProcessId={ProcessId}",
            serviceName, releaseId, Environment.ProcessId);
    }

    internal static void RecordGracefulStop(
        ILogger logger,
        string logRoot,
        string serviceName,
        string releaseId,
        string sourceIdentity)
    {
        var path = GetStatePath(logRoot);
        WriteState(path, new Dev5054ServiceProcessState
        {
            ServiceName = serviceName,
            ReleaseId = releaseId,
            SourceIdentity = sourceIdentity,
            ProcessId = Environment.ProcessId,
            StartedUtc = TryReadStartedUtc(path) ?? DateTimeOffset.UtcNow,
            GracefulStopRecordedUtc = DateTimeOffset.UtcNow
        });
        logger.LogInformation(new EventId(1007, "ServiceGracefulStopRecorded"),
            "ServiceGracefulStopRecorded ServiceName={ServiceName} ReleaseId={ReleaseId} ProcessId={ProcessId}",
            serviceName, releaseId, Environment.ProcessId);
    }

    private static string GetStatePath(string logRoot)
    {
        var root = Path.GetFullPath(logRoot);
        Directory.CreateDirectory(root);
        return Path.Combine(root, StateFileName);
    }

    private static DateTimeOffset? TryReadStartedUtc(string path)
    {
        if (!File.Exists(path)) return null;
        try
        {
            return JsonSerializer.Deserialize<Dev5054ServiceProcessState>(File.ReadAllText(path))?.StartedUtc;
        }
        catch (JsonException)
        {
            return null;
        }
    }

    private static void WriteState(string path, Dev5054ServiceProcessState state)
    {
        var temporary = path + "." + Guid.NewGuid().ToString("N") + ".tmp";
        try
        {
            File.WriteAllText(temporary, JsonSerializer.Serialize(state));
            File.Move(temporary, path, true);
        }
        finally
        {
            if (File.Exists(temporary)) File.Delete(temporary);
        }
    }
}
