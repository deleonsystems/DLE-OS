using System.Diagnostics;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

internal sealed class HostInstanceIdentity
{
    internal const string DefaultPath =
        @"C:\ProgramData\DLE-OS\GovernedRefreshControl\Qualification\host-instance.json";

    public string Schema { get; init; } = "dle-os.governed-refresh-host-instance.v1";
    public string ReleaseId { get; init; } = "";
    public string HostInstanceId { get; init; } = "";
    public DateTimeOffset StartedAtUtc { get; init; }
    public int ProcessId { get; init; }
    public string ExecutableSha256 { get; init; } = "";

    internal static HostInstanceIdentity Create(string path = DefaultPath)
    {
        var process = Process.GetCurrentProcess();
        var executable = Environment.ProcessPath ??
            throw new InvalidOperationException("The governed refresh executable path is unavailable.");
        var value = new HostInstanceIdentity
        {
            ReleaseId = ControlHostRuntimeConfiguration.ReleaseId,
            HostInstanceId = Guid.NewGuid().ToString("N").ToUpperInvariant(),
            StartedAtUtc = process.StartTime.ToUniversalTime(),
            ProcessId = Environment.ProcessId,
            ExecutableSha256 = Convert.ToHexString(SHA256.HashData(File.ReadAllBytes(executable)))
        };
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        var stage = path + "." + Guid.NewGuid().ToString("N") + ".tmp";
        File.WriteAllText(stage, JsonSerializer.Serialize(value,
            new JsonSerializerOptions { WriteIndented = true }) + Environment.NewLine,
            new UTF8Encoding(false));
        File.Move(stage, path, true);
        return value;
    }

    internal static HostInstanceIdentity ForQualification(
        string releaseId, string instanceId, DateTimeOffset startedAtUtc) => new()
    {
        ReleaseId = releaseId,
        HostInstanceId = instanceId,
        StartedAtUtc = startedAtUtc,
        ProcessId = Environment.ProcessId,
        ExecutableSha256 = new string('0', 64)
    };
}
