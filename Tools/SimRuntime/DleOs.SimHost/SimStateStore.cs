using System.Collections.Concurrent;
using System.Text.Json;

internal sealed record SimStateMetadata(
    string Environment,
    string ScenarioId,
    int ScenarioVersion,
    long Generation,
    int StateVersion,
    DateTimeOffset CreatedAtUtc,
    DateTimeOffset ResetAtUtc,
    int DeterministicSeed,
    DateTimeOffset DeterministicClockStartUtc,
    long NextDeterministicId,
    long NextEventOrdinal,
    long BrowserResetGeneration);

internal sealed record SimStateSnapshot(
    bool IsHealthy,
    string Health,
    SimStateMetadata? Metadata,
    string? ErrorCode,
    string? Message);

internal sealed record ResetSimStateRequest(string? Confirmation, string? RequestId);

internal sealed record SimResetResult(
    bool Succeeded,
    bool Replayed,
    string Environment,
    string ScenarioId,
    int ScenarioVersion,
    int StateVersion,
    long PreviousGeneration,
    long Generation,
    long BrowserResetGeneration,
    string DefaultPersonaId,
    bool ReloadRequired,
    object BrowserStorage);

internal sealed class SimStateStore
{
    internal const string BaselineScenarioId = "baseline";
    internal const int BaselineScenarioVersion = 5;
    internal const int CurrentStateVersion = 1;
    internal const int BaselineSeed = 2405001;
    internal static readonly DateTimeOffset BaselineClock =
        DateTimeOffset.Parse("2026-01-05T08:00:00Z", System.Globalization.CultureInfo.InvariantCulture);

    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        WriteIndented = true
    };

    private readonly string stateRoot;
    private readonly string stateDirectory;
    private readonly string metadataPath;
    private readonly string generationPath;
    private readonly SemaphoreSlim resetGate = new(1, 1);
    private readonly ConcurrentDictionary<string, SimResetResult> completedRequests =
        new(StringComparer.Ordinal);
    private readonly object snapshotGate = new();
    private SimStateSnapshot snapshot = new(false, "UNINITIALIZED", null,
        "DLE_OS_SIM_STATE_UNINITIALIZED", "SIM state has not been initialized.");

    internal SimStateStore(string stateRoot)
    {
        this.stateRoot = Path.GetFullPath(stateRoot);
        SimRuntimeOptions.EnsureDescendant(Path.GetDirectoryName(this.stateRoot)!, this.stateRoot);
        if (SimRuntimeOptions.IsNetworkPath(this.stateRoot))
            throw new InvalidOperationException("DLE-OS SIM state must not use a UNC or network path.");

        stateDirectory = SimRuntimeOptions.ResolveStatePath(this.stateRoot, "state");
        metadataPath = SimRuntimeOptions.ResolveStatePath(this.stateRoot, "state", "metadata.json");
        generationPath = SimRuntimeOptions.ResolveStatePath(this.stateRoot, "state", "generation.txt");
    }

    internal async Task InitializeAsync()
    {
        CreateLayout();
        if (!File.Exists(metadataPath))
        {
            var generation = ReadGenerationWatermark() + 1;
            var created = CreateBaseline(Math.Max(1, generation), DateTimeOffset.UtcNow);
            await WriteStateAsync(created);
            SetSnapshot(new(true, "READY", created, null, null));
            return;
        }

        SetSnapshot(await ReadSnapshotAsync());
    }

    internal SimStateSnapshot Current
    {
        get { lock (snapshotGate) return snapshot; }
    }

    internal async Task<(SimResetResult? Result, string? ErrorCode, string? Message)> ResetAsync(
        ResetSimStateRequest request,
        SimPersonaSessionStore personaSessions,
        HttpContext context,
        Func<SimStateMetadata, Task>? rebuildBusinessState = null)
    {
        if (!string.Equals(request.Confirmation, "RESET SIM", StringComparison.Ordinal))
            return (null, "DLE_OS_SIM_RESET_CONFIRMATION_REQUIRED",
                "Reset requires the exact confirmation phrase RESET SIM.");
        if (!Guid.TryParse(request.RequestId, out _))
            return (null, "DLE_OS_SIM_RESET_REQUEST_ID_INVALID",
                "Reset requires a UUID requestId so retries are idempotent.");
        if (completedRequests.TryGetValue(request.RequestId!, out var replay))
            return (replay with { Replayed = true }, null, null);
        if (!await resetGate.WaitAsync(0))
            return (null, "DLE_OS_SIM_RESET_IN_PROGRESS", "A SIM reset is already in progress.");

        try
        {
            if (completedRequests.TryGetValue(request.RequestId!, out replay))
                return (replay with { Replayed = true }, null, null);

            ValidateOwnedPath(stateDirectory);
            var current = Current.Metadata;
            var previousGeneration = current?.Generation ?? ReadGenerationWatermark();
            var generation = Math.Max(previousGeneration, ReadGenerationWatermark()) + 1;

            foreach (var name in new[] { "data", "documents", "generated", "temp" })
                ResetOwnedDirectory(name);

            var metadata = CreateBaseline(generation, DateTimeOffset.UtcNow);
            await WriteStateAsync(metadata);
            if (rebuildBusinessState is not null) await rebuildBusinessState(metadata);
            personaSessions.ResetAll(context);
            SetSnapshot(new(true, "READY", metadata, null, null));

            var result = new SimResetResult(
                true, false, "SIM", metadata.ScenarioId, metadata.ScenarioVersion,
                metadata.StateVersion, previousGeneration, metadata.Generation,
                metadata.BrowserResetGeneration, SimPersonaCatalog.DefaultPersonaId, true,
                BrowserStorageContract());
            completedRequests[request.RequestId!] = result;
            return (result, null, null);
        }
        catch (Exception exception) when (exception is IOException or UnauthorizedAccessException or InvalidOperationException)
        {
            SetSnapshot(new(false, "RESET_FAILED", null, "DLE_OS_SIM_STATE_RESET_FAILED",
                "SIM state reset failed safely. " + exception.Message));
            return (null, "DLE_OS_SIM_STATE_RESET_FAILED",
                "SIM state reset failed safely without falling back to an external resource.");
        }
        finally
        {
            resetGate.Release();
        }
    }

    internal object StatusContract()
    {
        var current = Current;
        return current.IsHealthy && current.Metadata is not null
            ? new
            {
                environment = current.Metadata.Environment,
                health = current.Health,
                scenarioId = current.Metadata.ScenarioId,
                scenarioVersion = current.Metadata.ScenarioVersion,
                generation = current.Metadata.Generation,
                stateVersion = current.Metadata.StateVersion,
                createdAtUtc = current.Metadata.CreatedAtUtc,
                resetAtUtc = current.Metadata.ResetAtUtc,
                deterministicSeed = current.Metadata.DeterministicSeed,
                deterministicClockStartUtc = current.Metadata.DeterministicClockStartUtc,
                nextDeterministicId = current.Metadata.NextDeterministicId,
                nextEventOrdinal = current.Metadata.NextEventOrdinal,
                browserResetGeneration = current.Metadata.BrowserResetGeneration,
                browserStorage = BrowserStorageContract()
            }
            : new
            {
                environment = "SIM",
                health = current.Health,
                code = current.ErrorCode,
                message = current.Message,
                resetAvailable = true
            };
    }

    internal static object BrowserStorageContract() => new
    {
        localStorageKeys = new[]
        {
            "DLE_OS_API_CONFIG",
            "DLE_OS_OPERATIONS_PROJECTION_V1",
            "DLE_OS_SHIPMENT_HISTORY_V1"
        },
        sessionStoragePrefixes = new[] { "dle-os:kitting-released-bom:return:" },
        indexedDbNames = new[] { "DLE_OS_SHIPMENT_STAGING_HANDLES" },
        generationKey = "dle-os:sim:browser-generation",
        scope = "CURRENT_SIM_ORIGIN_ONLY"
    };

    private void CreateLayout()
    {
        Directory.CreateDirectory(stateRoot);
        foreach (var name in new[] { "runtime", "state", "data", "documents", "generated", "logs", "temp" })
            Directory.CreateDirectory(SimRuntimeOptions.ResolveStatePath(stateRoot, name));
    }

    private async Task<SimStateSnapshot> ReadSnapshotAsync()
    {
        try
        {
            var json = await File.ReadAllTextAsync(metadataPath);
            var metadata = JsonSerializer.Deserialize<SimStateMetadata>(json, JsonOptions);
            if (metadata is null || metadata.Environment != "SIM" ||
                metadata.ScenarioId != BaselineScenarioId ||
                metadata.ScenarioVersion != BaselineScenarioVersion ||
                metadata.StateVersion != CurrentStateVersion || metadata.Generation < 1 ||
                metadata.BrowserResetGeneration != metadata.Generation)
            {
                return new(false, "INCOMPATIBLE", null, "DLE_OS_SIM_STATE_INCOMPATIBLE",
                    "SIM state metadata is incompatible. Use the SIM reset control to rebuild baseline state.");
            }
            return new(true, "READY", metadata, null, null);
        }
        catch (JsonException)
        {
            return new(false, "INVALID", null, "DLE_OS_SIM_STATE_INVALID",
                "SIM state metadata is invalid. Use the SIM reset control to rebuild baseline state.");
        }
        catch (IOException exception)
        {
            return new(false, "UNREADABLE", null, "DLE_OS_SIM_STATE_UNREADABLE",
                "SIM state metadata could not be read: " + exception.Message);
        }
    }

    private SimStateMetadata CreateBaseline(long generation, DateTimeOffset resetAtUtc) => new(
        "SIM", BaselineScenarioId, BaselineScenarioVersion, generation, CurrentStateVersion,
        resetAtUtc, resetAtUtc, BaselineSeed, BaselineClock, 1, 0, generation);

    private async Task WriteStateAsync(SimStateMetadata metadata)
    {
        ValidateOwnedPath(metadataPath);
        ValidateOwnedPath(generationPath);
        var metadataTemp = metadataPath + ".tmp-" + Guid.NewGuid().ToString("N");
        var generationTemp = generationPath + ".tmp-" + Guid.NewGuid().ToString("N");
        ValidateOwnedPath(metadataTemp);
        ValidateOwnedPath(generationTemp);
        try
        {
            await File.WriteAllTextAsync(metadataTemp, JsonSerializer.Serialize(metadata, JsonOptions));
            await File.WriteAllTextAsync(generationTemp, metadata.Generation.ToString(
                System.Globalization.CultureInfo.InvariantCulture));
            File.Move(metadataTemp, metadataPath, true);
            File.Move(generationTemp, generationPath, true);
        }
        finally
        {
            if (File.Exists(metadataTemp)) File.Delete(metadataTemp);
            if (File.Exists(generationTemp)) File.Delete(generationTemp);
        }
    }

    private long ReadGenerationWatermark()
    {
        try
        {
            return File.Exists(generationPath) && long.TryParse(File.ReadAllText(generationPath), out var value) && value > 0
                ? value
                : 0;
        }
        catch (IOException)
        {
            return 0;
        }
    }

    private void ResetOwnedDirectory(string name)
    {
        var path = SimRuntimeOptions.ResolveStatePath(stateRoot, name);
        ValidateOwnedPath(path);
        if (Directory.Exists(path))
        {
            EnsureNoReparsePoints(path);
            Directory.Delete(path, true);
        }
        Directory.CreateDirectory(path);
    }

    private static void EnsureNoReparsePoints(string root)
    {
        var pending = new Stack<DirectoryInfo>();
        pending.Push(new DirectoryInfo(root));
        while (pending.Count > 0)
        {
            var directory = pending.Pop();
            if ((directory.Attributes & FileAttributes.ReparsePoint) != 0)
                throw new InvalidOperationException("SIM reset rejected a reparse point inside disposable state.");
            foreach (var entry in directory.EnumerateFileSystemInfos())
            {
                if ((entry.Attributes & FileAttributes.ReparsePoint) != 0)
                    throw new InvalidOperationException("SIM reset rejected a reparse point inside disposable state.");
                if (entry is DirectoryInfo child) pending.Push(child);
            }
        }
    }

    private void ValidateOwnedPath(string path) => SimRuntimeOptions.EnsureDescendant(stateRoot, path);

    private void SetSnapshot(SimStateSnapshot value)
    {
        lock (snapshotGate) snapshot = value;
    }
}
