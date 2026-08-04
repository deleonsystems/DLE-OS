using System.Diagnostics;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;

internal static class PlatformRefreshCenter
{
    private const string ContractVersion = "platform-refresh-center-v1";
    private const string LiveApiBase = "http://DLE-OS-HOST:5042";
    private const string FrontendBuildEndpoint =
        "http://DLE-OS-HOST:5041/api/frontend/v1/build";
    private const string CoreStatePath =
        @"C:\ProgramData\DLE-OS\LiveSnapshotRefresh\State\status.json";
    private const string InvoiceStatePath =
        @"C:\DLE-OS\Canonical\InvoiceHistory\Refresh\State\status.json";
    private const string CustomerStatePath =
        @"C:\DLE-OS\Canonical\CustomerMaster\Refresh\State\status.json";
    private const string SalesStatePath =
        @"C:\DLE-OS\Canonical\OpenSalesOrders\Refresh\State\status.json";
    private const string OperationsStatePath =
        @"C:\DLE-OS\Canonical\OperationsRefresh\State\status.json";
    private const string NormalLauncher =
        @"C:\DLE-OS\Repositories\DLE-OS\Tools\LiveSnapshotRefresh\Start-LiveSnapshotRefresh.cmd";
    private const string ForceFullLauncher =
        @"C:\DLE-OS\Repositories\DLE-OS\Tools\LiveSnapshotRefresh\Start-LiveSnapshotForceFullRefresh.ps1";
    private const string InvoiceLauncher =
        @"C:\DLE-OS\Repositories\DLE-OS\Tools\InvoiceHistory\Start-InvoiceHistoryRefresh.cmd";
    private const string CustomerLauncher =
        @"C:\DLE-OS\Repositories\DLE-OS\Tools\OperationsRefresh\Start-CustomerMasterRefresh.cmd";
    private const string SalesLauncher =
        @"C:\DLE-OS\Repositories\DLE-OS\Tools\OperationsRefresh\Start-OpenSalesOrderRefresh.cmd";
    private const string AuditRoot =
        @"C:\ProgramData\DLE-OS\PlatformRefreshCenter";
    private const string AuditPath =
        @"C:\ProgramData\DLE-OS\PlatformRefreshCenter\refresh-runs.jsonl";
    private static readonly object ActionGate = new();
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNameCaseInsensitive = true,
        WriteIndented = false
    };

    internal static void MapPlatformRefreshCenter(
        this WebApplication app,
        string authorizedOperator,
        string authorizationPolicy)
    {
        var registry = LoadRegistry();

        app.MapGet(
                "/api/platform/refresh-center/v1/status",
                async () => Results.Json(
                    await BuildStatusAsync(registry)))
            .RequireAuthorization(authorizationPolicy);

        app.MapGet(
                "/api/platform/refresh-center/v1/datasets/{datasetId}",
                async (string datasetId) =>
                {
                    var dataset = FindDataset(registry, datasetId);
                    return dataset is null
                        ? Results.NotFound(new
                        {
                            code = "dataset_not_found",
                            datasetId
                        })
                        : Results.Json(
                            await BuildDatasetStatusAsync(dataset));
                })
            .RequireAuthorization(authorizationPolicy);

        app.MapGet(
                "/api/platform/refresh-center/v1/runs",
                () =>
                {
                    ReconcileAuditRuns();
                    return Results.Json(
                        ReadAuditRuns().TakeLast(100).Reverse());
                })
            .RequireAuthorization(authorizationPolicy);

        app.MapGet(
                "/api/platform/refresh-center/v1/runs/{runId}",
                (string runId) =>
                {
                    ReconcileAuditRuns();
                    var run = ReadAuditRuns().LastOrDefault(
                        item => string.Equals(
                            item["requestId"]?.GetValue<string>(),
                            runId,
                            StringComparison.OrdinalIgnoreCase));
                    return run is null
                        ? Results.NotFound(new { code = "run_not_found", runId })
                        : Results.Json(run);
                })
            .RequireAuthorization(authorizationPolicy);

        app.MapPost(
                "/api/platform/refresh-center/v1/datasets/{datasetId}/check-source",
                (HttpContext context, string datasetId) =>
                    StartDatasetAction(
                        context,
                        registry,
                        datasetId,
                        "check-source",
                        authorizedOperator,
                        quietWindowReady: false))
            .RequireAuthorization(authorizationPolicy);

        app.MapPost(
                "/api/platform/refresh-center/v1/datasets/{datasetId}/refresh",
                (
                    HttpContext context,
                    string datasetId,
                    RefreshActionRequest? request) =>
                    StartDatasetAction(
                        context,
                        registry,
                        datasetId,
                        "refresh",
                        authorizedOperator,
                        request?.QuietWindowReady == true))
            .RequireAuthorization(authorizationPolicy);

        app.MapPost(
                "/api/platform/refresh-center/v1/datasets/{datasetId}/reconcile",
                (HttpContext context, string datasetId) =>
                    UnsupportedAction(registry, datasetId, "reconcile"))
            .RequireAuthorization(authorizationPolicy);

        app.MapPost(
                "/api/platform/refresh-center/v1/core/force-full",
                (
                    HttpContext context,
                    ForceFullRequest? request) =>
                    StartForceFull(
                        context,
                        registry,
                        authorizedOperator,
                        request))
            .RequireAuthorization(authorizationPolicy);
    }

    internal static RegistryDocument LoadRegistry(string? path = null)
    {
        path ??= Path.Combine(
            AppContext.BaseDirectory,
            "PlatformRefreshRegistry.json");
        if (!File.Exists(path))
        {
            throw new InvalidOperationException(
                $"The governed refresh registry is unavailable: {path}");
        }
        var registry = JsonSerializer.Deserialize<RegistryDocument>(
            File.ReadAllText(path),
            JsonOptions) ?? throw new InvalidOperationException(
                "The governed refresh registry is invalid.");
        ValidateRegistry(registry);
        return registry;
    }

    internal static void ValidateRegistry(RegistryDocument registry)
    {
        if (!string.Equals(
                registry.ContractVersion,
                ContractVersion,
                StringComparison.Ordinal))
        {
            throw new InvalidOperationException(
                "Refresh registry contract version mismatch.");
        }
        if (registry.Datasets.Count != 12)
        {
            throw new InvalidOperationException(
                "The governed registry must contain exactly twelve datasets.");
        }
        var duplicate = registry.Datasets
            .GroupBy(item => item.DatasetId, StringComparer.OrdinalIgnoreCase)
            .FirstOrDefault(group => group.Count() != 1);
        if (duplicate is not null)
        {
            throw new InvalidOperationException(
                $"Duplicate dataset ID: {duplicate.Key}");
        }
        foreach (var dataset in registry.Datasets)
        {
            if (string.IsNullOrWhiteSpace(dataset.DatasetId) ||
                string.IsNullOrWhiteSpace(dataset.StatusProvider) ||
                string.IsNullOrWhiteSpace(dataset.RefreshCapability) ||
                string.IsNullOrWhiteSpace(dataset.RefreshMethod))
            {
                throw new InvalidOperationException(
                    "A refresh registry entry is incomplete.");
            }
            if (dataset.SupportsRoutineRefresh &&
                dataset.DatasetId is not (
                    "invoice-history" or "customer-master" or "sales-order"))
            {
                throw new InvalidOperationException(
                    "An unexpected dataset claims a qualified routine refresh.");
            }
        }
    }

    private static DatasetRegistryEntry? FindDataset(
        RegistryDocument registry,
        string datasetId) =>
        registry.Datasets.FirstOrDefault(item =>
            string.Equals(
                item.DatasetId,
                datasetId,
                StringComparison.OrdinalIgnoreCase));

    private static async Task<JsonObject> BuildStatusAsync(
        RegistryDocument registry)
    {
        var datasetTasks = registry.Datasets.Select(BuildDatasetStatusAsync);
        var datasets = await Task.WhenAll(datasetTasks);
        var liveReadiness = await TryGetJsonAsync(
            $"{LiveApiBase}/api/platform/live/v1/readiness");
        var frontend = await TryGetJsonAsync(FrontendBuildEndpoint);
        var warnings = new JsonArray();
        foreach (var dataset in datasets.Where(item =>
                     item["state"]?.GetValue<string>() is
                         "Unavailable" or "ReadyWithWarning" or
                         "RefreshQualificationRequired"))
        {
            warnings.Add(
                $"{dataset["displayName"]}: {dataset["stateReason"]}");
        }
        var running = datasets
            .Where(item =>
                string.Equals(
                    item["state"]?.GetValue<string>(),
                    "Running",
                    StringComparison.Ordinal))
            .Select(item => item["datasetId"]?.GetValue<string>())
            .ToArray();
        return new JsonObject
        {
            ["contractVersion"] = ContractVersion,
            ["registryVersion"] = registry.RegistryVersion,
            ["generatedAtUtc"] = DateTimeOffset.UtcNow.ToString("O"),
            ["overallPlatformState"] =
                liveReadiness?["readinessVerdict"]?.GetValue<string>() ??
                "Unavailable",
            ["datasets"] = new JsonArray(
                datasets.Select(item => (JsonNode?)item).ToArray()),
            ["runningOperations"] = JsonSerializer.SerializeToNode(running),
            ["sharedRuntimeHealth"] = new JsonObject
            {
                ["liveApi"] = liveReadiness is null
                    ? "Unavailable"
                    : "Reachable",
                ["refreshControlHost"] = "Ready",
                ["frontend"] = frontend is null
                    ? "Unavailable"
                    : "Reachable"
            },
            ["ports"] = new JsonObject
            {
                ["frontend"] = 5041,
                ["liveApi"] = 5042,
                ["refreshControlHost"] = 5043,
                ["promotionBroker"] = 5044
            },
            ["frontendBuildId"] =
                frontend?["frontendBuildId"]?.DeepClone(),
            ["liveApiContractVersion"] =
                liveReadiness?["apiContractVersion"]?.DeepClone(),
            ["sourceCheckReadiness"] = liveReadiness?.DeepClone(),
            ["warnings"] = warnings
        };
    }

    private static async Task<JsonObject> BuildDatasetStatusAsync(
        DatasetRegistryEntry dataset)
    {
        JsonNode? metadata;
        if (dataset.StatusProvider.StartsWith(
                "core:",
                StringComparison.OrdinalIgnoreCase))
        {
            metadata = await TryGetJsonAsync(
                $"{LiveApiBase}/api/platform/live/v1/readiness");
        }
        else
        {
            metadata = await TryGetJsonAsync(
                $"{LiveApiBase}{dataset.CurrentImportMetadataProvider}");
        }
        if (metadata is null)
        {
            return BaseDatasetStatus(
                dataset,
                "Unavailable",
                "The dataset metadata provider is unavailable.");
        }

        var result = BaseDatasetStatus(
            dataset,
            dataset.RefreshCapability == "RefreshQualificationRequired"
                ? "ReadyWithWarning"
                : "Ready",
            dataset.OperatorMessage);
        result["metadata"] = metadata.DeepClone();
        result["rowCounts"] = dataset.StatusProvider.StartsWith(
                "core:",
                StringComparison.OrdinalIgnoreCase) ||
            string.Equals(
                dataset.DatasetId,
                "sales-order",
                StringComparison.OrdinalIgnoreCase)
            ? await BuildCoreRowCountAsync(dataset, metadata)
            : BuildMetadataRowCounts(dataset, metadata);
        result["activeImportRunId"] =
            FirstNode(metadata, "currentImportRunId", "importRunId") ??
            FirstNodeEndingWith(metadata, "ImportRunId");
        result["activePackageHash"] =
            FirstNode(
                metadata,
                "packageHash",
                "packageSha256",
                "packageContentHash");
        result["snapshotAsOfUtc"] =
            FirstNode(
                metadata,
                "snapshotTimestampUtc",
                "snapshotAsOfUtc",
                "importedAtUtc",
                "activatedAtUtc");
        result["lastSuccessfulImportUtc"] =
            FirstNode(
                metadata,
                "importedAtUtc",
                "activatedAtUtc",
                "snapshotTimestampUtc");
        result["lastSuccessfulSourceCheckUtc"] =
            FirstNode(metadata, "sourceCheckedAtUtc");
        result["lastFullQualificationUtc"] =
            FirstNode(metadata, "qualificationCompletedAtUtc");
        result["warningCount"] =
            metadata["warnings"] is JsonArray warningArray
                ? warningArray.Count
                : CountQualityWarnings(metadata);
        result["unresolvedCount"] =
            FirstNode(
                metadata,
                "unresolvedWorkOrderCount",
                "unresolvedCodeCount",
                "unresolvedCount");
        result["ambiguousCount"] =
            FirstNode(
                metadata,
                "ambiguousWorkOrderCount",
                "ambiguousCodeCount",
                "ambiguousCount");
        result["recommendedOperatorAction"] =
            dataset.RefreshCapability == "RefreshQualificationRequired"
                ? $"Qualification required: {dataset.FollowOnMilestone}"
                : "No action required";

        var state = ReadStateForDataset(dataset.DatasetId);
        if (state is not null)
        {
            result["lastAttemptedOperation"] =
                FirstNode(state, "phase", "refreshMode");
            result["lastResult"] =
                FirstNode(state, "lastResult", "result", "status");
            result["currentRunningPhase"] =
                FirstNode(state, "phase");
            result["failureReason"] =
                FirstNode(state, "lastFailureReason");
            result["runningProgress"] =
                FirstNode(state, "message");
            if (StateIsRunning(state))
            {
                result["state"] = "Running";
                result["stateReason"] =
                    "A governed refresh operation is running.";
            }
            else if (StateFailed(state))
            {
                result["state"] = "FailedRetainingPriorData";
                result["stateReason"] =
                    "The last refresh failed; prior qualified data remains active.";
            }
            else if (StateNoChanges(state))
            {
                result["lastResult"] = "NO_SOURCE_CHANGES";
            }
        }
        return result;
    }

    private static JsonObject BaseDatasetStatus(
        DatasetRegistryEntry dataset,
        string state,
        string reason) => new()
    {
        ["datasetId"] = dataset.DatasetId,
        ["displayName"] = dataset.DisplayName,
        ["state"] = state,
        ["stateReason"] = reason,
        ["refreshCapability"] = dataset.RefreshCapability,
        ["refreshMethod"] = dataset.RefreshMethod,
        ["estimatedDurationClass"] = dataset.EstimatedDurationClass,
        ["supportsSourceCheck"] = dataset.SupportsSourceCheck,
        ["supportsRoutineRefresh"] = dataset.SupportsRoutineRefresh,
        ["supportsForceFull"] = dataset.SupportsForceFull,
        ["supportsReconciliation"] = dataset.SupportsReconciliation,
        ["requiresQuietWindow"] = dataset.RequiresQuietWindow,
        ["sourceAccessMode"] = "MODE=\"O_RDONLY\"",
        ["dependencies"] =
            JsonSerializer.SerializeToNode(dataset.Dependencies),
        ["followOnMilestone"] = dataset.FollowOnMilestone,
        ["operatorMessage"] = dataset.OperatorMessage
    };

    private static IResult StartDatasetAction(
        HttpContext context,
        RegistryDocument registry,
        string datasetId,
        string action,
        string authorizedOperator,
        bool quietWindowReady)
    {
        var dataset = FindDataset(registry, datasetId);
        if (dataset is null)
        {
            return Results.NotFound(
                new { code = "dataset_not_found", datasetId });
        }
        var supported =
            action == "check-source" && dataset.SupportsSourceCheck ||
            action == "refresh" && dataset.SupportsRoutineRefresh;
        if (!supported)
        {
            return UnsupportedAction(registry, datasetId, action);
        }
        var launcher = action == "check-source"
            ? NormalLauncher
            : dataset.DatasetId switch
            {
                "customer-master" => CustomerLauncher,
                "sales-order" => SalesLauncher,
                "invoice-history" => InvoiceLauncher,
                _ => ""
            };
        if (dataset.RequiresQuietWindow && !quietWindowReady)
        {
            return Results.BadRequest(new
            {
                code = "quiet_window_confirmation_required",
                datasetId,
                action,
                status = "AwaitingQuietWindow"
            });
        }
        return StartAllowlistedLauncher(
            context,
            dataset,
            action,
            launcher,
            authorizedOperator,
            quietWindowReady,
            forceFullIntent: false);
    }

    private static IResult StartForceFull(
        HttpContext context,
        RegistryDocument registry,
        string authorizedOperator,
        ForceFullRequest? request)
    {
        if (request is null ||
            request.ForceFullIntent != true ||
            request.QuietWindowReady != true ||
            !string.Equals(
                request.Confirmation,
                "FORCE FULL ERP SNAPSHOT",
                StringComparison.Ordinal))
        {
            return Results.BadRequest(new
            {
                code = "force_full_confirmation_required",
                status = "AwaitingOperator",
                requiredConfirmation = "FORCE FULL ERP SNAPSHOT",
                requiresQuietWindow = true
            });
        }
        var core = FindDataset(registry, "sales-order")!;
        return StartAllowlistedLauncher(
            context,
            core,
            "force-full",
            ForceFullLauncher,
            authorizedOperator,
            quietWindowReady: true,
            forceFullIntent: true);
    }

    private static IResult UnsupportedAction(
        RegistryDocument registry,
        string datasetId,
        string action)
    {
        var dataset = FindDataset(registry, datasetId);
        if (dataset is null)
        {
            return Results.NotFound(
                new { code = "dataset_not_found", datasetId });
        }
        return Results.Json(
            new
            {
                code = "RefreshNotImplemented",
                datasetId,
                action,
                message = dataset.OperatorMessage,
                followOnMilestone = dataset.FollowOnMilestone
            },
            statusCode: StatusCodes.Status409Conflict);
    }

    private static IResult StartAllowlistedLauncher(
        HttpContext context,
        DatasetRegistryEntry dataset,
        string action,
        string launcher,
        string authorizedOperator,
        bool quietWindowReady,
        bool forceFullIntent)
    {
        lock (ActionGate)
        {
            if (AnyLiveSourceOperationRunning())
            {
                return Results.Conflict(new
                {
                    code = "already_running",
                    status = "ALREADY_RUNNING",
                    message =
                        "An incompatible governed live-source operation is already running."
                });
            }
            if (!File.Exists(launcher))
            {
                return Results.Json(
                    new
                    {
                        code = "runner_unavailable",
                        status = "Unavailable"
                    },
                    statusCode: StatusCodes.Status503ServiceUnavailable);
            }
            var before = ReadStateForDataset(dataset.DatasetId);
            var beforeMetadata = GetMetadataForDataset(dataset);
            var requestId =
                $"REFRESH-CENTER-{DateTimeOffset.UtcNow:yyyyMMddTHHmmssZ}-" +
                Convert.ToHexString(RandomNumberGenerator.GetBytes(4));
            var audit = new JsonObject
            {
                ["requestId"] = requestId,
                ["datasetId"] = dataset.DatasetId,
                ["action"] = action,
                ["requestedBy"] = context.User.Identity?.Name,
                ["requestedAtUtc"] = DateTimeOffset.UtcNow.ToString("O"),
                ["startedAtUtc"] = DateTimeOffset.UtcNow.ToString("O"),
                ["result"] = "STARTED",
                ["runnerControlRoute"] =
                    $"/api/platform/refresh-center/v1/datasets/{dataset.DatasetId}/{action}",
                ["importRunIdBefore"] =
                    GetMetadataImportRunId(beforeMetadata) ??
                    FirstNode(before, "activeImportRunId", "importRunId"),
                ["packageHashBefore"] =
                    GetMetadataPackageHash(beforeMetadata) ??
                    FirstNode(before, "currentPackageHash", "packageHash"),
                ["snapshotAsOfBefore"] =
                    GetMetadataSnapshotAsOf(beforeMetadata),
                ["sourceCheckedAtBefore"] =
                    FirstNode(before, "lastSourceCheckUtc"),
                ["quietWindowConfirmation"] = quietWindowReady,
                ["forceFullIntent"] = forceFullIntent,
                ["authorizedIdentity"] = authorizedOperator
            };
            AppendAudit(audit);
            Process? process;
            if (launcher.EndsWith(".ps1", StringComparison.OrdinalIgnoreCase))
            {
                process = Process.Start(new ProcessStartInfo
                {
                    FileName = "powershell.exe",
                    Arguments =
                        $"-NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File \"{launcher}\"",
                    UseShellExecute = true,
                    WindowStyle = ProcessWindowStyle.Hidden
                });
            }
            else
            {
                process = Process.Start(new ProcessStartInfo
                {
                    FileName = Path.Combine(
                        Environment.GetFolderPath(
                            Environment.SpecialFolder.Windows),
                        "explorer.exe"),
                    Arguments = $"\"{launcher}\"",
                    UseShellExecute = true
                });
            }
            if (process is null)
            {
                return Results.Json(
                    new
                    {
                        code = "runner_start_failed",
                        status = "Unavailable"
                    },
                    statusCode: StatusCodes.Status503ServiceUnavailable);
            }
            return Results.Accepted(
                $"/api/platform/refresh-center/v1/datasets/{dataset.DatasetId}",
                new
                {
                    requestId,
                    datasetId = dataset.DatasetId,
                    action,
                    status = "Running",
                    executionIdentity = authorizedOperator,
                    quietWindowReady,
                    forceFullIntent
                });
        }
    }

    private static bool AnyLiveSourceOperationRunning()
    {
        var core = ReadJsonFile(CoreStatePath);
        var invoice = ReadJsonFile(InvoiceStatePath);
        var customer = ReadJsonFile(CustomerStatePath);
        var sales = ReadJsonFile(SalesStatePath);
        var operations = ReadJsonFile(OperationsStatePath);
        return StateIsRunning(core) || StateIsRunning(invoice) ||
            StateIsRunning(customer) || StateIsRunning(sales) ||
            StateIsRunning(operations);
    }

    private static JsonNode? ReadStateForDataset(string datasetId) =>
        datasetId switch
        {
            "invoice-history" => ReadJsonFile(InvoiceStatePath),
            "customer-master" => ReadJsonFile(CustomerStatePath),
            "sales-order" => ReadJsonFile(SalesStatePath),
            _ when datasetId is
                "bill-of-material" or "inventory-item" or "work-order" or
                "general-ledger-account" => ReadJsonFile(CoreStatePath),
            _ => null
        };

    private static JsonNode? ReadJsonFile(string path)
    {
        try
        {
            return File.Exists(path)
                ? JsonNode.Parse(File.ReadAllText(path))
                : null;
        }
        catch
        {
            return null;
        }
    }

    private static bool StateIsRunning(JsonNode? state) =>
        state?["running"]?.GetValue<bool>() == true ||
        string.Equals(
            FirstString(state, "status", "result"),
            "RUNNING",
            StringComparison.OrdinalIgnoreCase);

    private static bool StateFailed(JsonNode? state) =>
        string.Equals(
            FirstString(state, "status", "result", "lastResult"),
            "FAILED",
            StringComparison.OrdinalIgnoreCase);

    private static bool StateNoChanges(JsonNode? state) =>
        string.Equals(
            FirstString(state, "status", "result", "lastResult"),
            "NO_SOURCE_CHANGES",
            StringComparison.OrdinalIgnoreCase);

    private static JsonNode? FirstNode(
        JsonNode? source,
        params string[] names)
    {
        if (source is not JsonObject objectNode)
        {
            return null;
        }
        foreach (var name in names)
        {
            var property = objectNode.FirstOrDefault(item =>
                string.Equals(
                    item.Key,
                    name,
                    StringComparison.OrdinalIgnoreCase));
            if (property.Value is not null)
            {
                return property.Value.DeepClone();
            }
        }
        return null;
    }

    private static string? FirstString(
        JsonNode? source,
        params string[] names)
    {
        var node = FirstNode(source, names);
        try
        {
            return node?.GetValue<string>();
        }
        catch
        {
            return node?.ToJsonString();
        }
    }

    private static JsonNode? FirstNodeEndingWith(
        JsonNode? source,
        string suffix)
    {
        if (source is not JsonObject objectNode)
        {
            return null;
        }
        var property = objectNode.FirstOrDefault(item =>
            item.Key.EndsWith(
                suffix,
                StringComparison.OrdinalIgnoreCase));
        return property.Value?.DeepClone();
    }

    private static JsonNode BuildMetadataRowCounts(
        DatasetRegistryEntry dataset,
        JsonNode metadata)
    {
        var fields = dataset.DatasetId switch
        {
            "invoice-history" => new[]
            {
                "customerInvoiceCount", "customerInvoiceLineCount"
            },
            "customer-master" => new[]
            {
                "customerCount", "customerAddressCount"
            },
            "vendor-master" => new[]
            {
                "vendorCount", "vendorAddressCount"
            },
            "purchase-order" => new[]
            {
                "headerCount", "lineCount"
            },
            "receiving-history" => new[]
            {
                "headerCount", "lineCount", "rejectionCount"
            },
            "employee-reference" => new[]
            {
                "employeeCount", "operationalCodeCount",
                "departmentCount", "jobTitleCount"
            },
            "reference-code" => new[]
            {
                "referenceCodeCount"
            },
            _ => Array.Empty<string>()
        };
        var counts = new JsonObject();
        foreach (var field in fields)
        {
            counts[field] = FirstNode(metadata, field);
        }
        return counts;
    }

    private static long CountQualityWarnings(JsonNode metadata)
    {
        if (metadata is not JsonObject objectNode)
        {
            return 0;
        }
        var warningTokens = new[]
        {
            "orphan", "unresolved", "ambiguous", "malformed", "missing"
        };
        long total = 0;
        foreach (var property in objectNode)
        {
            if (!property.Key.EndsWith(
                    "Count",
                    StringComparison.OrdinalIgnoreCase) ||
                !warningTokens.Any(token =>
                    property.Key.Contains(
                        token,
                        StringComparison.OrdinalIgnoreCase)))
            {
                continue;
            }
            try
            {
                total += property.Value?.GetValue<long>() ?? 0;
            }
            catch
            {
                // A nonnumeric qualified warning property is ignored.
            }
        }
        return total;
    }

    private static async Task<JsonNode?> BuildCoreRowCountAsync(
        DatasetRegistryEntry dataset,
        JsonNode metadata)
    {
        var providerKey = dataset.StatusProvider[
            (dataset.StatusProvider.IndexOf(':') + 1)..];
        var count = FirstNode(metadata["entityCounts"], providerKey);
        if (count is null &&
            string.Equals(
                dataset.DatasetId,
                "sales-order",
                StringComparison.OrdinalIgnoreCase))
        {
            var salesOrders = await TryGetJsonAsync(
                $"{LiveApiBase}/api/platform/live/v1/sales-orders?page=1&pageSize=1");
            count = FirstNode(salesOrders, "totalItems", "totalCount");
        }
        return new JsonObject
        {
            [dataset.EntityNames.FirstOrDefault() ?? dataset.DatasetId] =
                count
        };
    }

    private static async Task<JsonNode?> TryGetJsonAsync(string uri)
    {
        try
        {
            using var client = new HttpClient
            {
                Timeout = TimeSpan.FromSeconds(5)
            };
            using var response = await client.GetAsync(uri);
            if (!response.IsSuccessStatusCode)
            {
                return null;
            }
            return JsonNode.Parse(await response.Content.ReadAsStringAsync());
        }
        catch
        {
            return null;
        }
    }

    private static JsonNode? GetMetadataForDataset(
        DatasetRegistryEntry dataset)
    {
        var uri = dataset.StatusProvider.StartsWith(
            "core:",
            StringComparison.OrdinalIgnoreCase)
            ? $"{LiveApiBase}/api/platform/live/v1/readiness"
            : $"{LiveApiBase}{dataset.CurrentImportMetadataProvider}";
        return TryGetJsonAsync(uri).GetAwaiter().GetResult();
    }

    private static JsonNode? GetMetadataImportRunId(JsonNode? metadata) =>
        FirstNode(metadata, "currentImportRunId", "importRunId") ??
        FirstNodeEndingWith(metadata, "ImportRunId");

    private static JsonNode? GetMetadataPackageHash(JsonNode? metadata) =>
        FirstNode(
            metadata,
            "packageHash",
            "packageSha256",
            "packageContentHash");

    private static JsonNode? GetMetadataSnapshotAsOf(JsonNode? metadata) =>
        FirstNode(
            metadata,
            "snapshotTimestampUtc",
            "snapshotAsOfUtc",
            "importedAtUtc",
            "activatedAtUtc");

    private static void AppendAudit(JsonObject audit)
    {
        Directory.CreateDirectory(AuditRoot);
        File.AppendAllText(
            AuditPath,
            audit.ToJsonString(JsonOptions) + Environment.NewLine,
            new UTF8Encoding(encoderShouldEmitUTF8Identifier: false));
    }

    private static IReadOnlyList<JsonObject> ReadAuditRuns()
    {
        try
        {
            if (!File.Exists(AuditPath))
            {
                return [];
            }
            return File.ReadLines(AuditPath)
                .Where(line => !string.IsNullOrWhiteSpace(line))
                .Select(line => JsonNode.Parse(line) as JsonObject)
                .Where(node => node is not null)
                .Cast<JsonObject>()
                .GroupBy(
                    node => node["requestId"]?.GetValue<string>() ?? "",
                    StringComparer.OrdinalIgnoreCase)
                .Select(group =>
                {
                    var merged = new JsonObject();
                    foreach (var item in group)
                    {
                        foreach (var property in item)
                        {
                            merged[property.Key] =
                                property.Value?.DeepClone();
                        }
                    }
                    return merged;
                })
                .ToArray();
        }
        catch
        {
            return [];
        }
    }

    private static void ReconcileAuditRuns()
    {
        var registry = LoadRegistry();
        var pending = ReadAuditRuns()
            .Where(run => string.Equals(
                run["result"]?.GetValue<string>(),
                "STARTED",
                StringComparison.OrdinalIgnoreCase))
            .ToArray();
        foreach (var run in pending)
        {
            var datasetId = run["datasetId"]?.GetValue<string>() ?? "";
            var dataset = FindDataset(registry, datasetId);
            var state = ReadStateForDataset(datasetId);
            if (dataset is null || state is null || StateIsRunning(state))
            {
                continue;
            }
            var requested = DateTimeOffset.TryParse(
                run["requestedAtUtc"]?.GetValue<string>(),
                out var parsedRequested)
                ? parsedRequested
                : DateTimeOffset.MaxValue;
            var stateTimestampText = FirstString(
                state,
                "updatedAtUtc",
                "completedAtUtc",
                "lastSourceCheckUtc");
            if (!DateTimeOffset.TryParse(
                    stateTimestampText,
                    out var stateTimestamp) ||
                stateTimestamp < requested)
            {
                continue;
            }
            var afterMetadata = GetMetadataForDataset(dataset);
            AppendAudit(new JsonObject
            {
                ["requestId"] = run["requestId"]?.DeepClone(),
                ["completedAtUtc"] = stateTimestamp.ToString("O"),
                ["result"] =
                    FirstNode(state, "lastResult", "result", "status"),
                ["sourceRunId"] =
                    FirstNode(state, "runId", "refreshRunId"),
                ["importRunIdAfter"] =
                    GetMetadataImportRunId(afterMetadata) ??
                    FirstNode(
                        state,
                        "activeImportRunId",
                        "importRunId"),
                ["packageHashAfter"] =
                    GetMetadataPackageHash(afterMetadata) ??
                    FirstNode(
                        state,
                        "currentPackageHash",
                        "packageHash"),
                ["snapshotAsOfAfter"] =
                    GetMetadataSnapshotAsOf(afterMetadata),
                ["sourceCheckedAtAfter"] =
                    FirstNode(state, "lastSourceCheckUtc"),
                ["failureReason"] =
                    FirstNode(state, "lastFailureReason"),
                ["rollbackResult"] = StateFailed(state)
                    ? "PRIOR_QUALIFIED_DATA_RETAINED"
                    : "NOT_REQUIRED"
            });
        }
    }
}

internal sealed class RefreshActionRequest
{
    public bool QuietWindowReady { get; set; }
}

internal sealed class ForceFullRequest
{
    public bool ForceFullIntent { get; set; }
    public bool QuietWindowReady { get; set; }
    public string? Confirmation { get; set; }
}

internal sealed class RegistryDocument
{
    public string ContractVersion { get; set; } = "";
    public string RegistryVersion { get; set; } = "";
    public string AuthorizedIdentity { get; set; } = "";
    public string AllowedBrowserOrigin { get; set; } = "";
    public List<DatasetRegistryEntry> Datasets { get; set; } = [];
}

internal sealed class DatasetRegistryEntry
{
    public string DatasetId { get; set; } = "";
    public string DisplayName { get; set; } = "";
    public string PlatformSectionId { get; set; } = "";
    public List<string> EntityNames { get; set; } = [];
    public string RefreshCapability { get; set; } = "";
    public string RefreshMethod { get; set; } = "";
    public string StatusProvider { get; set; } = "";
    public string TriggerRoute { get; set; } = "";
    public bool RequiresAuthentication { get; set; }
    public string AuthorizedIdentity { get; set; } = "";
    public bool RequiresQuietWindow { get; set; }
    public string EstimatedDurationClass { get; set; } = "";
    public bool SupportsSourceCheck { get; set; }
    public bool SupportsRoutineRefresh { get; set; }
    public bool SupportsForceFull { get; set; }
    public bool SupportsReconciliation { get; set; }
    public string CurrentImportMetadataProvider { get; set; } = "";
    public string WarningPolicy { get; set; } = "";
    public List<string> Dependencies { get; set; } = [];
    public int RunOrder { get; set; }
    public bool IsEnabled { get; set; }
    public string OperatorMessage { get; set; } = "";
    public string FollowOnMilestone { get; set; } = "";
    public List<string> AuthoritativeSources { get; set; } = [];
    public string ConcurrencyGroup { get; set; } = "";
}
