using System.Security.Principal;
using System.Text.Json;

internal static class WorkerIdentityPreflight
{
    internal static WorkerIdentityEvidence? RunIfRequested()
    {
        if (!ControlHostRuntimeConfiguration.RunWorkerPreflight) return null;
        var path = Path.GetFullPath(ControlHostRuntimeConfiguration.WorkerPreflightEvidencePath);
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        var escaped = path.Replace("'", "''", StringComparison.Ordinal);
        var command =
            "$i=[Security.Principal.WindowsIdentity]::GetCurrent();" +
            "$p=[Security.Principal.WindowsPrincipal]::new($i);" +
            "$v=[ordered]@{CapturedAtUtc=[DateTimeOffset]::UtcNow.ToString('O');ProcessId=$PID;" +
            "Identity=$i.Name;AdministratorRole=$p.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator);" +
            "Probe='INVOICE_HISTORY_NORMAL_USER_TOKEN'};" +
            $"[IO.File]::WriteAllText('{escaped}',(($v|ConvertTo-Json -Depth 4)+[Environment]::NewLine)," +
            "[Text.UTF8Encoding]::new($false));" +
            "if($i.Name -ine 'DLE-OS-HOST\\DLE-OS' -or $v.AdministratorRole){exit 17}";
        using var process = NormalUserProcess.Start("powershell.exe",
            ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", command],
            @"C:\DLE-OS\Repositories\DLE-OS");
        if (!process.WaitForExit(30_000))
        { process.Kill(entireProcessTree: true); throw new InvalidOperationException("Worker identity preflight timed out."); }
        if (!File.Exists(path)) throw new InvalidOperationException("Worker identity preflight produced no evidence.");
        var evidence = JsonSerializer.Deserialize<WorkerIdentityEvidence>(File.ReadAllText(path),
            new JsonSerializerOptions { PropertyNameCaseInsensitive = true }) ??
            throw new InvalidOperationException("Worker identity evidence was invalid.");
        if (!string.Equals(evidence.Identity, @"DLE-OS-HOST\DLE-OS", StringComparison.OrdinalIgnoreCase) ||
            evidence.AdministratorRole)
            throw new InvalidOperationException("Worker preflight did not produce the required non-admin token.");
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
