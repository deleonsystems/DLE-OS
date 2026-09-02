using System.Security.Principal;
using System.Text.Json;

internal static class WorkerIdentityPreflight
{
    private const string RequiredWorkerIdentity = @"DLE-OS-HOST\DLE-OS";

    internal static WorkerIdentityEvidence? RunIfRequested()
    {
        if (!ControlHostRuntimeConfiguration.RunWorkerPreflight)
            return null;

        var path = Path.GetFullPath(
            ControlHostRuntimeConfiguration.WorkerPreflightEvidencePath);
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        var escapedPath = path.Replace("'", "''", StringComparison.Ordinal);
        var command =
            "$i=[Security.Principal.WindowsIdentity]::GetCurrent();" +
            "$p=[Security.Principal.WindowsPrincipal]::new($i);" +
            "$v=[ordered]@{CapturedAtUtc=[DateTimeOffset]::UtcNow.ToString('O');" +
            "ProcessId=$PID;Identity=$i.Name;AdministratorRole=$p.IsInRole(" +
            "[Security.Principal.WindowsBuiltInRole]::Administrator);" +
            "Probe='SYNC_OPERATIONS_NORMAL_USER_TOKEN'};" +
            $"[IO.File]::WriteAllText('{escapedPath}',(($v|ConvertTo-Json -Depth 4)+[Environment]::NewLine)," +
            "[Text.UTF8Encoding]::new($false));" +
            "if($i.Name -ine 'DLE-OS-HOST\\DLE-OS' -or $v.AdministratorRole){exit 17}";

        using var process = NormalUserProcess.Start("powershell.exe",
        [
            "-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass",
            "-Command", command
        ], @"C:\DLE-OS\Repositories\DLE-OS");

        if (!process.WaitForExit(30_000))
        {
            process.Kill(entireProcessTree: true);
            throw new InvalidOperationException(
                "The non-admin Sync Operations worker identity preflight timed out.");
        }
        // NormalUserProcess intentionally returns a Process reattached by PID
        // after CreateProcessAsUser. ExitCode is unavailable on that Process
        // object even after WaitForExit. The evidence contract below retains
        // the fail-closed semantics: absence, malformed JSON, wrong identity,
        // or an administrative token all reject startup.
        if (!File.Exists(path))
            throw new InvalidOperationException(
                "The non-admin Sync Operations worker identity preflight produced no evidence.");

        var evidence = JsonSerializer.Deserialize<WorkerIdentityEvidence>(
            File.ReadAllText(path), new JsonSerializerOptions
            {
                PropertyNameCaseInsensitive = true
            }) ?? throw new InvalidOperationException(
                "The worker identity preflight evidence was invalid.");
        if (!string.Equals(evidence.Identity, RequiredWorkerIdentity,
                StringComparison.OrdinalIgnoreCase) || evidence.AdministratorRole)
            throw new InvalidOperationException(
                "The worker identity preflight did not produce the required non-admin token.");
        return evidence;
    }
}

internal sealed class WorkerIdentityEvidence
{
    public string CapturedAtUtc { get; set; } = "";
    public int ProcessId { get; set; }
    public string Identity { get; set; } = "";
    public bool AdministratorRole { get; set; }
    public string Probe { get; set; } = "";
}
