using System.Diagnostics;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Security.AccessControl;
using System.Security.Principal;
using System.Text.Json;

internal static class SyncOperationsRoutes
{
    internal static void MapSyncOperations(this WebApplication app, string policy)
    {
        app.MapPost("/api/sync/operations",
            (HttpContext context, SyncOperationsCenter center) =>
                center.Start(context)).RequireAuthorization(policy);
        app.MapGet("/api/sync/operations/current",
            (SyncOperationsCenter center) => center.Current()).RequireAuthorization(policy);
        app.MapGet("/api/sync/operations/runs/{runId}",
            (string runId, SyncOperationsCenter center) => center.Run(runId)).RequireAuthorization(policy);
        app.MapGet("/api/sync/operations/runs",
            (SyncOperationsCenter center) => center.Runs()).RequireAuthorization(policy);
    }
}

internal sealed class SyncOperationsCenter
{
    private const string Operation = "FOCUSED_OPERATIONAL_SYNC_V1";
    private const string Script =
        @"C:\DLE-OS\Repositories\DLE-OS\Tools\SyncOperations\Invoke-SyncOperations.ps1";
    private readonly object gate = new();
    private readonly JsonSerializerOptions json = new() { WriteIndented = true };
    private readonly string root = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData),
        "DLE-OS", "SyncOperations");

    internal IResult Start(HttpContext context)
    {
        lock (gate)
        {
            Directory.CreateDirectory(root);
            Directory.CreateDirectory(RunsRoot);
            EnsureWorkerStateAccess();
            var active = ReadLease();
            if (active is not null && LeaseOwnerIsAlive(active))
                return Results.Conflict(new { code = "ALREADY_RUNNING", activeRun = active });
            if (active is not null)
                RecoverStaleLease(active);
            var conflictingLock = ExistingCanonicalChangingLock();
            if (conflictingLock is not null)
                return Results.Conflict(new { code = "ALREADY_RUNNING", conflictingLock });

            var now = DateTimeOffset.UtcNow;
            var runId = "SYNCOPS-" + now.ToString("yyyyMMddTHHmmssZ") + "-" +
                        Guid.NewGuid().ToString("N")[..8].ToUpperInvariant();
            var actor = TrustedDevelopmentIdentity.RequireActorName(context);
            var state = new SyncOperationsState
            {
                RunId = runId, Operation = Operation, Status = "QUEUED",
                CurrentStep = "Queued", RequestedBy = actor,
                RequestedAtUtc = now, HeartbeatAtUtc = now,
                ExecutionIdentity = @"DLE-OS-HOST\DLE-OS"
            };
            WriteJson(RunPath(runId), state, createNew: true);
            WriteJson(CurrentPath, state);
            var lease = new SyncOperationsLease
            {
                RunId = runId, Operation = Operation, RequestedBy = actor,
                CreatedAtUtc = now, HeartbeatAtUtc = now, Status = "QUEUED"
            };
            WriteJson(LeasePath, lease, createNew: true);
            try
            {
                conflictingLock = ExistingCanonicalChangingLock();
                if (conflictingLock is not null)
                    throw new InvalidOperationException(
                        "ALREADY_RUNNING: a canonical-changing workflow acquired " + conflictingLock + ".");
                var process = NormalUserProcess.Start("powershell.exe",
                [
                    "-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass",
                    "-File", Script, "-RunId", runId, "-RequestedBy", actor,
                    "-StatePath", RunPath(runId), "-CurrentPath", CurrentPath,
                    "-LeasePath", LeasePath
                ], @"C:\DLE-OS\Repositories\DLE-OS");
                if (process.WaitForExit(500))
                    throw new InvalidOperationException(
                        "The governed synchronization worker exited during startup.");
                lease.OwnerProcessId = process.Id;
                lease.OwnerProcessStartedAtUtc = process.StartTime.ToUniversalTime();
                lease.Status = "RUNNING";
                WriteJson(LeasePath, lease);
                state.OwnerProcessId = process.Id;
                state.Status = "RUNNING";
                state.StartedAtUtc = now;
                WriteJson(RunPath(runId), state);
                WriteJson(CurrentPath, state);
                return Results.Json(state, statusCode: StatusCodes.Status202Accepted);
            }
            catch (Exception error)
            {
                var failedAt = DateTimeOffset.UtcNow;
                state.Status = "FAILED_TO_START";
                state.CompletedAtUtc = failedAt;
                state.HeartbeatAtUtc = failedAt;
                state.Result = error.Message;
                WriteJson(RunPath(runId), state);
                WriteJson(CurrentPath, state);
                File.Delete(LeasePath);
                throw;
            }
        }
    }

    internal IResult Current()
    {
        lock (gate)
        {
            var snapshot = SyncOperationsStatusSnapshot.ReadOptional(CurrentPath);
            if (snapshot is null)
                return Results.Json(new { status = "NEVER_RUN" });
            var state = JsonSerializer.Deserialize<SyncOperationsState>(
                snapshot, json);
            if (state is not null && state.Status is "QUEUED" or "RUNNING")
            {
                var lease = ReadLease();
                if (lease is not null && !LeaseOwnerIsAlive(lease))
                    RecoverStaleLease(lease);
                else if (lease is null)
                    RecoverOrphanedCurrent(state);
                snapshot = SyncOperationsStatusSnapshot.ReadOptional(CurrentPath);
                if (snapshot is null)
                    return Results.Json(new { status = "NEVER_RUN" });
            }
            return Results.Bytes(snapshot, "application/json");
        }
    }

    internal IResult Run(string runId)
    {
        if (!ValidRunId(runId))
            return Results.NotFound(new { code = "SYNC_RUN_NOT_FOUND" });
        var snapshot = SyncOperationsStatusSnapshot.ReadOptional(RunPath(runId));
        return snapshot is null
            ? Results.NotFound(new { code = "SYNC_RUN_NOT_FOUND" })
            : Results.Bytes(snapshot, "application/json");
    }

    internal IResult Runs()
    {
        Directory.CreateDirectory(RunsRoot);
        var runs = Directory.GetFiles(RunsRoot, "SYNCOPS-*.json")
            .OrderByDescending(path => path, StringComparer.OrdinalIgnoreCase).Take(25)
            .Select(path => JsonSerializer.Deserialize<SyncOperationsState>(File.ReadAllText(path), json));
        return Results.Json(runs);
    }

    private string RunsRoot => Path.Combine(root, "Runs");
    private string LeasePath => Path.Combine(root, "lease.json");
    private string CurrentPath => Path.Combine(root, "current.json");
    private string RunPath(string runId) => Path.Combine(RunsRoot, runId + ".json");

    private void EnsureWorkerStateAccess()
    {
        var directory = new DirectoryInfo(root);
        var security = directory.GetAccessControl();
        security.AddAccessRule(new FileSystemAccessRule(
            @"DLE-OS-HOST\DLE-OS",
            FileSystemRights.Modify | FileSystemRights.Synchronize,
            InheritanceFlags.ContainerInherit | InheritanceFlags.ObjectInherit,
            PropagationFlags.None,
            AccessControlType.Allow));
        directory.SetAccessControl(security);
    }
    private static bool ValidRunId(string value) =>
        value.StartsWith("SYNCOPS-", StringComparison.Ordinal) &&
        value.All(c => char.IsAsciiLetterOrDigit(c) || c == '-');

    private SyncOperationsLease? ReadLease()
    {
        try { return File.Exists(LeasePath) ? JsonSerializer.Deserialize<SyncOperationsLease>(File.ReadAllText(LeasePath), json) : null; }
        catch { return new SyncOperationsLease { RunId = "UNREADABLE", Status = "STALE" }; }
    }

    private static string? ExistingCanonicalChangingLock()
    {
        string[] paths =
        [
            @"C:\DLE-OS\Canonical\DailyOperationsSync\State\daily-operations-sync.lock",
            @"C:\DLE-OS\Canonical\InvoiceHistory\Refresh\State\invoice-history-refresh.lock",
            @"C:\DLE-OS\Canonical\CustomerMaster\Refresh\State\customer-master-refresh.lock",
            @"C:\DLE-OS\Canonical\OpenSalesOrders\Refresh\State\open-sales-order-refresh.lock",
            @"C:\ProgramData\DLE-OS\LiveSnapshotRefresh\State\refresh.lock"
        ];
        return paths.FirstOrDefault(File.Exists);
    }

    private static bool LeaseOwnerIsAlive(SyncOperationsLease lease)
    {
        if (lease.OwnerProcessId <= 0)
            return DateTimeOffset.UtcNow - lease.CreatedAtUtc < TimeSpan.FromMinutes(1);
        try
        {
            using var process = Process.GetProcessById(lease.OwnerProcessId);
            return !process.HasExited && lease.OwnerProcessStartedAtUtc is not null &&
                   Math.Abs((process.StartTime.ToUniversalTime() - lease.OwnerProcessStartedAtUtc.Value.UtcDateTime)
                       .TotalSeconds) < 2;
        }
        catch { return false; }
    }

    private void RecoverStaleLease(SyncOperationsLease lease)
    {
        if (ValidRunId(lease.RunId) && File.Exists(RunPath(lease.RunId)))
        {
            var state = JsonSerializer.Deserialize<SyncOperationsState>(File.ReadAllText(RunPath(lease.RunId)), json);
            if (state is not null)
            {
                state.Status = "ABANDONED_STALE_OWNER";
                state.CompletedAtUtc = DateTimeOffset.UtcNow;
                state.Result = "The prior worker no longer exists; its durable lease was recovered.";
                WriteJson(RunPath(lease.RunId), state);
                WriteJson(CurrentPath, state);
            }
        }
        File.Move(LeasePath, Path.Combine(root, $"stale-{DateTimeOffset.UtcNow:yyyyMMddTHHmmssfffZ}.json"));
    }

    private void RecoverOrphanedCurrent(SyncOperationsState state)
    {
        var now = DateTimeOffset.UtcNow;
        state.Status = "ABANDONED_STALE_OWNER";
        state.CompletedAtUtc = now;
        state.HeartbeatAtUtc = now;
        state.Result = "The active-looking state had no durable lease and was recovered.";
        if (ValidRunId(state.RunId) && File.Exists(RunPath(state.RunId)))
            WriteJson(RunPath(state.RunId), state);
        WriteJson(CurrentPath, state);
    }

    private void WriteJson<T>(string path, T value, bool createNew = false)
    {
        if (createNew)
        {
            using var stream = new FileStream(path, FileMode.CreateNew, FileAccess.Write, FileShare.Read,
                4096, FileOptions.WriteThrough);
            JsonSerializer.Serialize(stream, value, json);
            return;
        }
        var stage = path + "." + Guid.NewGuid().ToString("N") + ".tmp";
        File.WriteAllText(stage, JsonSerializer.Serialize(value, json));
        File.Move(stage, path, true);
    }
}

internal static class NormalUserProcess
{
    private const uint SaferScopeMachine = 1;
    private const uint SaferLevelNormalUser = 0x20000;
    private const uint SaferLevelOpen = 1;
    private const uint CreateNoWindow = 0x08000000;
    private const uint CreateUnicodeEnvironment = 0x00000400;

    internal static Process Start(string executable, IReadOnlyList<string> arguments,
        string workingDirectory)
    {
        if (!SaferCreateLevel(SaferScopeMachine, SaferLevelNormalUser, SaferLevelOpen,
                out var level, IntPtr.Zero))
            throw Win32("SaferCreateLevel");
        IntPtr token = IntPtr.Zero;
        IntPtr environment = IntPtr.Zero;
        try
        {
            if (!SaferComputeTokenFromLevel(level, IntPtr.Zero, out token, 0, IntPtr.Zero))
                throw Win32("SaferComputeTokenFromLevel");
            if (!CreateEnvironmentBlock(out environment, token, true))
                throw Win32("CreateEnvironmentBlock");
            var commandLine = new System.Text.StringBuilder(string.Join(" ",
                new[] { Quote(executable) }.Concat(arguments.Select(Quote))));
            var startup = new StartupInfo { Size = Marshal.SizeOf<StartupInfo>() };
            if (!CreateProcessAsUser(token, null, commandLine, IntPtr.Zero, IntPtr.Zero,
                    false, CreateNoWindow | CreateUnicodeEnvironment, environment,
                    workingDirectory, ref startup,
                    out var created))
                throw Win32("CreateProcessAsUser");
            try
            {
                return Process.GetProcessById(unchecked((int)created.ProcessId));
            }
            finally
            {
                CloseHandle(created.Thread);
                CloseHandle(created.Process);
            }
        }
        finally
        {
            if (environment != IntPtr.Zero) DestroyEnvironmentBlock(environment);
            if (token != IntPtr.Zero) CloseHandle(token);
            SaferCloseLevel(level);
        }
    }

    private static string Quote(string value)
    {
        if (value.Length > 0 && value.All(c => !char.IsWhiteSpace(c) && c != '"')) return value;
        var result = new System.Text.StringBuilder("\"");
        var slashes = 0;
        foreach (var character in value)
        {
            if (character == '\\') { slashes++; continue; }
            if (character == '"')
            {
                result.Append('\\', slashes * 2 + 1).Append('"');
                slashes = 0;
                continue;
            }
            result.Append('\\', slashes).Append(character);
            slashes = 0;
        }
        result.Append('\\', slashes * 2).Append('"');
        return result.ToString();
    }

    private static Win32Exception Win32(string operation) =>
        new(Marshal.GetLastWin32Error(), operation + " failed");

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct StartupInfo
    {
        public int Size;
        public string? Reserved;
        public string? Desktop;
        public string? Title;
        public int X, Y, XSize, YSize, XCountChars, YCountChars, FillAttribute, Flags;
        public short ShowWindow, Reserved2;
        public IntPtr ReservedPointer, StandardInput, StandardOutput, StandardError;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct ProcessInformation
    {
        public IntPtr Process;
        public IntPtr Thread;
        public uint ProcessId;
        public uint ThreadId;
    }

    [DllImport("advapi32.dll", SetLastError = true)]
    private static extern bool SaferCreateLevel(uint scopeId, uint levelId, uint openFlags,
        out IntPtr levelHandle, IntPtr reserved);
    [DllImport("advapi32.dll", SetLastError = true)]
    private static extern bool SaferComputeTokenFromLevel(IntPtr levelHandle, IntPtr inputToken,
        out IntPtr outputToken, uint flags, IntPtr reserved);
    [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool CreateProcessAsUser(IntPtr token, string? applicationName,
        System.Text.StringBuilder commandLine, IntPtr processAttributes, IntPtr threadAttributes,
        bool inheritHandles, uint creationFlags, IntPtr environment, string currentDirectory,
        ref StartupInfo startupInfo, out ProcessInformation processInformation);
    [DllImport("userenv.dll", SetLastError = true)]
    private static extern bool CreateEnvironmentBlock(out IntPtr environment, IntPtr token,
        bool inherit);
    [DllImport("userenv.dll")]
    private static extern bool DestroyEnvironmentBlock(IntPtr environment);
    [DllImport("advapi32.dll")]
    private static extern bool SaferCloseLevel(IntPtr levelHandle);
    [DllImport("kernel32.dll")]
    private static extern bool CloseHandle(IntPtr handle);
}

internal sealed class SyncOperationsLease
{
    public string RunId { get; set; } = "";
    public string Operation { get; set; } = "";
    public string RequestedBy { get; set; } = "";
    public DateTimeOffset CreatedAtUtc { get; set; }
    public DateTimeOffset HeartbeatAtUtc { get; set; }
    public int OwnerProcessId { get; set; }
    public DateTimeOffset? OwnerProcessStartedAtUtc { get; set; }
    public string Status { get; set; } = "";
}

internal sealed class SyncOperationsState
{
    public string RunId { get; set; } = "";
    public string Operation { get; set; } = "";
    public string Status { get; set; } = "";
    public string CurrentStep { get; set; } = "";
    public string RequestedBy { get; set; } = "";
    public DateTimeOffset RequestedAtUtc { get; set; }
    public DateTimeOffset? StartedAtUtc { get; set; }
    public DateTimeOffset? CompletedAtUtc { get; set; }
    public DateTimeOffset HeartbeatAtUtc { get; set; }
    public int OwnerProcessId { get; set; }
    public string ExecutionIdentity { get; set; } = "";
    public object? DailyOperations { get; set; }
    public object? InvoiceHistory { get; set; }
    public object? CanonicalReadiness { get; set; }
    public string? Result { get; set; }
}
