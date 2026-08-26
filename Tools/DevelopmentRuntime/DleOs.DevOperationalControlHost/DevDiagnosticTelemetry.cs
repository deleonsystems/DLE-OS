using System.Collections.Concurrent;
using System.Diagnostics;
using System.Net;
using System.Net.Http;
using System.Runtime.InteropServices;
using System.Security.Principal;
using Microsoft.Data.SqlClient;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

internal sealed class DevDiagnosticTelemetry :
    IObserver<DiagnosticListener>, IObserver<KeyValuePair<string, object?>>, IDisposable
{
    private static readonly AsyncLocal<string?> Correlation = new();
    private static ILogger? stageLogger;
    private readonly ILogger diagnosticLogger;
    private readonly Uri canonicalBase;
    private readonly IDisposable allListenersSubscription;
    private readonly List<IDisposable> listenerSubscriptions = [];
    private readonly ConcurrentDictionary<HttpRequestMessage, OperationState> httpOperations = new();
    private readonly ConcurrentDictionary<Guid, OperationState> sqlOperations = new();
    private int disposed;

    private DevDiagnosticTelemetry(ILoggerFactory loggerFactory, IHostEnvironment environment,
        string releaseId, string canonicalApiBaseUrl)
    {
        diagnosticLogger = loggerFactory.CreateLogger("DleOs.Dev5054.DiagnosticTiming");
        stageLogger = diagnosticLogger;
        canonicalBase = new Uri(canonicalApiBaseUrl, UriKind.Absolute);
        RecordRuntimeContext(environment, releaseId);
        allListenersSubscription = DiagnosticListener.AllListeners.Subscribe(this);
    }

    internal static DevDiagnosticTelemetry Start(ILoggerFactory loggerFactory, IHostEnvironment environment,
        string releaseId, string canonicalApiBaseUrl) =>
        new(loggerFactory, environment, releaseId, canonicalApiBaseUrl);

    internal static IDisposable PushCorrelation(string correlationId)
    {
        var prior = Correlation.Value;
        Correlation.Value = correlationId;
        return new CorrelationScope(prior);
    }

    internal static string CurrentCorrelationId =>
        Correlation.Value ?? Activity.Current?.TraceId.ToString() ?? "NO_CORRELATION";

    internal static DiagnosticTimingScope? BeginPermissionResolution(string permissionCode)
        => stageLogger is null ? null : new(stageLogger, "PermissionResolution", permissionCode);

    internal static DiagnosticTimingScope? BeginEnrichmentStage(PathString path)
    {
        var operation = ClassifyRoute(path.Value);
        return operation is null || stageLogger is null ? null : new(stageLogger, operation, path.Value ?? "");
    }

    public void OnNext(DiagnosticListener listener)
    {
        if (listener.Name.Contains("HttpHandlerDiagnosticListener", StringComparison.Ordinal) ||
            listener.Name.Contains("SqlClientDiagnosticListener", StringComparison.Ordinal))
        {
            lock (listenerSubscriptions)
                listenerSubscriptions.Add(listener.Subscribe(this));
        }
    }

    public void OnNext(KeyValuePair<string, object?> value)
    {
        try
        {
            if (value.Key.StartsWith("System.Net.Http.HttpRequestOut.", StringComparison.Ordinal))
                ObserveHttp(value.Key, value.Value);
            else if (value.Key.StartsWith("Microsoft.Data.SqlClient.Write", StringComparison.Ordinal))
                ObserveSql(value.Key, value.Value);
        }
        catch (Exception error)
        {
            diagnosticLogger.LogWarning(new EventId(3199, "DiagnosticObserverFailure"),
                "DiagnosticObserverFailure Event={DiagnosticEvent} ExceptionType={ExceptionType}",
                value.Key, error.GetType().FullName);
        }
    }

    public void OnError(Exception error) => diagnosticLogger.LogWarning(
        new EventId(3198, "DiagnosticListenerFailure"),
        "DiagnosticListenerFailure ExceptionType={ExceptionType}", error.GetType().FullName);

    public void OnCompleted() { }

    public void Dispose()
    {
        if (Interlocked.Exchange(ref disposed, 1) != 0) return;
        allListenersSubscription.Dispose();
        lock (listenerSubscriptions)
        {
            foreach (var subscription in listenerSubscriptions) subscription.Dispose();
            listenerSubscriptions.Clear();
        }
        stageLogger = null;
    }

    private void ObserveHttp(string eventName, object? payload)
    {
        var request = Property<HttpRequestMessage>(payload, "Request");
        if (request?.RequestUri is not { } uri || !IsCanonical5052(uri)) return;

        if (eventName.EndsWith(".Start", StringComparison.Ordinal))
        {
            var state = new OperationState(CorrelationId(), DateTimeOffset.UtcNow, Stopwatch.GetTimestamp(),
                ClassifyCanonicalRequest(uri), uri.AbsoluteUri);
            httpOperations[request] = state;
            diagnosticLogger.LogInformation(new EventId(3100, "Canonical5052RequestStart"),
                "Canonical5052RequestStart CorrelationId={CorrelationId} Operation={Operation} TargetUri={TargetUri} StartUtc={StartUtc} DefaultCredentialsEnabled={DefaultCredentialsEnabled}",
                state.CorrelationId, state.Operation, state.Target, state.StartUtc, true);
            return;
        }

        if (!httpOperations.TryRemove(request, out var completed)) return;
        var response = Property<HttpResponseMessage>(payload, "Response");
        var exception = Property<Exception>(payload, "Exception");
        var canceled = exception is OperationCanceledException ||
            string.Equals(Property<object>(payload, "RequestTaskStatus")?.ToString(), "Canceled",
                StringComparison.OrdinalIgnoreCase);
        diagnosticLogger.Log(canceled || exception is not null ? LogLevel.Warning : LogLevel.Information,
            new EventId(3101, "Canonical5052RequestComplete"),
            "Canonical5052RequestComplete CorrelationId={CorrelationId} Operation={Operation} TargetUri={TargetUri} StartUtc={StartUtc} ElapsedMs={ElapsedMs} HttpStatus={HttpStatus} TimeoutOrCancellation={TimeoutOrCancellation} ExceptionType={ExceptionType} ExceptionCategory={ExceptionCategory} DefaultCredentialsEnabled={DefaultCredentialsEnabled}",
            completed.CorrelationId, completed.Operation, completed.Target, completed.StartUtc,
            completed.ElapsedMilliseconds, response is null ? null : (int)response.StatusCode,
            canceled, exception?.GetType().FullName, ClassifyException(exception), true);
    }

    private void ObserveSql(string eventName, object? payload)
    {
        var operationId = Property<Guid?>(payload, "OperationId") ?? Guid.Empty;
        if (operationId == Guid.Empty) return;
        var command = Property<SqlCommand>(payload, "Command");
        var connection = command?.Connection ?? Property<SqlConnection>(payload, "Connection");
        var database = connection?.Database ?? "";
        if (!database.Equals("DLE_OS_OPERATIONAL_DEV", StringComparison.Ordinal) &&
            !database.Equals("DLE_OS_SECURITY_DEV", StringComparison.Ordinal)) return;

        if (eventName.EndsWith("Before", StringComparison.Ordinal))
        {
            var operation = command is null ? "SqlConnectionOpen" : ClassifySql(command.CommandText, database);
            var state = new OperationState(CorrelationId(), DateTimeOffset.UtcNow, Stopwatch.GetTimestamp(),
                operation, database);
            sqlOperations[operationId] = state;
            diagnosticLogger.LogInformation(new EventId(3110, "DevSqlOperationStart"),
                "DevSqlOperationStart CorrelationId={CorrelationId} Operation={Operation} Database={Database} StartUtc={StartUtc}",
                state.CorrelationId, state.Operation, state.Target, state.StartUtc);
            return;
        }

        if (!sqlOperations.TryRemove(operationId, out var completed)) return;
        var exception = Property<Exception>(payload, "Exception");
        var canceled = exception is OperationCanceledException;
        diagnosticLogger.Log(exception is null ? LogLevel.Information : LogLevel.Warning,
            new EventId(3111, "DevSqlOperationComplete"),
            "DevSqlOperationComplete CorrelationId={CorrelationId} Operation={Operation} Database={Database} StartUtc={StartUtc} ElapsedMs={ElapsedMs} TimeoutOrCancellation={TimeoutOrCancellation} ExceptionType={ExceptionType} ExceptionCategory={ExceptionCategory}",
            completed.CorrelationId, completed.Operation, completed.Target, completed.StartUtc,
            completed.ElapsedMilliseconds, canceled, exception?.GetType().FullName, ClassifyException(exception));
    }

    private void RecordRuntimeContext(IHostEnvironment environment, string releaseId)
    {
        using var identity = WindowsIdentity.GetCurrent();
        var groups = identity.Groups?.Select(group => group.Value).OrderBy(value => value,
            StringComparer.Ordinal).ToArray() ?? [];
        var userProfile = Environment.GetEnvironmentVariable("USERPROFILE");
        var temp = Environment.GetEnvironmentVariable("TEMP");
        var tmp = Environment.GetEnvironmentVariable("TMP");
        var proxy = HttpClient.DefaultProxy;
        Uri? effectiveProxy = null;
        var proxyBypassed = true;
        try
        {
            proxyBypassed = proxy.IsBypassed(canonicalBase);
            if (!proxyBypassed) effectiveProxy = proxy.GetProxy(canonicalBase);
        }
        catch (NotSupportedException) { }

        var logonType = TryGetLogonType(identity.Token, out var type) ? type : "UNAVAILABLE";
        diagnosticLogger.LogInformation(new EventId(3000, "DiagnosticRuntimeContext"),
            "DiagnosticRuntimeContext ReleaseId={ReleaseId} ProcessIdentity={ProcessIdentity} AuthenticationType={AuthenticationType} ImpersonationLevel={ImpersonationLevel} LogonType={LogonType} GroupSids={GroupSids} CurrentDirectory={CurrentDirectory} ContentRoot={ContentRoot} UserProfilePresent={UserProfilePresent} Temp={Temp} Tmp={Tmp} Configured5052Uri={Configured5052Uri} ProxyBypassed={ProxyBypassed} EffectiveProxy={EffectiveProxy}",
            releaseId, identity.Name, identity.AuthenticationType, identity.ImpersonationLevel.ToString(),
            logonType, string.Join(",", groups), Environment.CurrentDirectory, environment.ContentRootPath,
            !string.IsNullOrWhiteSpace(userProfile), temp, tmp, canonicalBase.AbsoluteUri,
            proxyBypassed, effectiveProxy?.AbsoluteUri);
    }

    private bool IsCanonical5052(Uri uri) => uri.Port == canonicalBase.Port &&
        (uri.Host.Equals(canonicalBase.Host, StringComparison.OrdinalIgnoreCase) ||
         uri.Host.Equals("dle-os-host", StringComparison.OrdinalIgnoreCase));

    private static string? ClassifyRoute(string? path)
    {
        if (path is null) return null;
        if (path.StartsWith("/api/work-order-approvals/", StringComparison.OrdinalIgnoreCase))
            return "WorkOrderApprovalEnrichment";
        if (path.StartsWith("/api/operational-work-order-relationships/", StringComparison.OrdinalIgnoreCase))
            return "OperationalRelationshipEnrichment";
        if (path.StartsWith("/api/kitting-cases/", StringComparison.OrdinalIgnoreCase) ||
            path.StartsWith("/api/kitting-dispositions/", StringComparison.OrdinalIgnoreCase))
            return "KittingCaseMaterialStatusProjection";
        if (path.StartsWith("/api/rma-rework/", StringComparison.OrdinalIgnoreCase))
            return "RmaMembershipLoading";
        if (path.StartsWith("/api/shipment-staging/", StringComparison.OrdinalIgnoreCase))
            return "ShipmentEnrichment";
        return null;
    }

    private static string ClassifyCanonicalRequest(Uri uri)
    {
        var path = uri.AbsolutePath;
        if (path.Contains("sales-order-work-order-relationships", StringComparison.OrdinalIgnoreCase))
            return "CanonicalWorkOrderRelationship";
        if (path.Contains("invoice-history", StringComparison.OrdinalIgnoreCase)) return "CanonicalInvoiceHistory";
        if (path.Contains("receiving-history", StringComparison.OrdinalIgnoreCase)) return "CanonicalReceivingHistory";
        if (path.Contains("work-orders", StringComparison.OrdinalIgnoreCase)) return "CanonicalWorkOrder";
        if (path.Contains("sales-orders", StringComparison.OrdinalIgnoreCase)) return "CanonicalSalesOrder";
        return "Canonical5052Request";
    }

    private static string ClassifySql(string commandText, string database)
    {
        if (database.Equals("DLE_OS_SECURITY_DEV", StringComparison.Ordinal))
        {
            if (commandText.Contains("security.UserRole", StringComparison.OrdinalIgnoreCase) ||
                commandText.Contains("security.[User]", StringComparison.OrdinalIgnoreCase))
                return "SecurityPermissionResolutionQuery";
            return "SecuritySqlQuery";
        }
        if (commandText.Contains("RmaReworkCaseMember", StringComparison.OrdinalIgnoreCase))
            return "OperationalRmaMembershipQuery";
        if (commandText.Contains("WorkOrderApproval", StringComparison.OrdinalIgnoreCase))
            return "OperationalWorkOrderApprovalQuery";
        if (commandText.Contains("WorkOrderInterpretation", StringComparison.OrdinalIgnoreCase))
            return "OperationalRelationshipQuery";
        if (commandText.Contains("KittingCase", StringComparison.OrdinalIgnoreCase))
            return "OperationalKittingCaseQuery";
        if (commandText.Contains("ShipmentStaging", StringComparison.OrdinalIgnoreCase))
            return "OperationalShipmentQuery";
        return "OperationalSqlQuery";
    }

    private static string ClassifyException(Exception? error)
    {
        if (error is null) return "NONE";
        if (error is TaskCanceledException or OperationCanceledException) return "TIMEOUT_OR_CANCELLATION";
        if (error is HttpRequestException) return "CANONICAL_5052_HTTP";
        if (error is SqlException) return "DEV_SQL";
        return "OTHER";
    }

    private static string CorrelationId() => CurrentCorrelationId;

    private static T? Property<T>(object? value, string name)
    {
        if (value is null) return default;
        var property = value.GetType().GetProperty(name);
        if (property?.GetValue(value) is T typed) return typed;
        return default;
    }

    private static bool TryGetLogonType(IntPtr token, out string logonType)
    {
        logonType = "UNAVAILABLE";
        try
        {
            var size = Marshal.SizeOf<TokenStatistics>();
            var buffer = Marshal.AllocHGlobal(size);
            try
            {
                if (!GetTokenInformation(token, 10, buffer, size, out _)) return false;
                var statistics = Marshal.PtrToStructure<TokenStatistics>(buffer);
                if (LsaGetLogonSessionData(ref statistics.AuthenticationId, out var data) != 0 || data == IntPtr.Zero)
                    return false;
                try
                {
                    var session = Marshal.PtrToStructure<SecurityLogonSessionData>(data);
                    logonType = session.LogonType switch
                    {
                        2 => "Interactive", 3 => "Network", 4 => "Batch", 5 => "Service",
                        7 => "Unlock", 8 => "NetworkCleartext", 9 => "NewCredentials",
                        10 => "RemoteInteractive", 11 => "CachedInteractive", _ => session.LogonType.ToString()
                    };
                    return true;
                }
                finally { LsaFreeReturnBuffer(data); }
            }
            finally { Marshal.FreeHGlobal(buffer); }
        }
        catch (Exception error) when (error is System.ComponentModel.Win32Exception or SEHException)
        {
            return false;
        }
    }

    [DllImport("advapi32.dll", SetLastError = true)]
    private static extern bool GetTokenInformation(IntPtr token, int tokenInformationClass,
        IntPtr tokenInformation, int tokenInformationLength, out int returnLength);

    [DllImport("secur32.dll")]
    private static extern uint LsaGetLogonSessionData(ref Luid logonId, out IntPtr ppLogonSessionData);

    [DllImport("secur32.dll")]
    private static extern uint LsaFreeReturnBuffer(IntPtr buffer);

    [StructLayout(LayoutKind.Sequential)]
    private struct Luid { public uint LowPart; public int HighPart; }

    [StructLayout(LayoutKind.Sequential)]
    private struct TokenStatistics
    {
        public Luid TokenId;
        public Luid AuthenticationId;
        public long ExpirationTime;
        public int TokenType;
        public int ImpersonationLevel;
        public uint DynamicCharged;
        public uint DynamicAvailable;
        public uint GroupCount;
        public uint PrivilegeCount;
        public Luid ModifiedId;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct LsaUnicodeString
    {
        public ushort Length;
        public ushort MaximumLength;
        public IntPtr Buffer;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct SecurityLogonSessionData
    {
        public uint Size;
        public Luid LogonId;
        public LsaUnicodeString UserName;
        public LsaUnicodeString LogonDomain;
        public LsaUnicodeString AuthenticationPackage;
        public uint LogonType;
    }

    private sealed record OperationState(string CorrelationId, DateTimeOffset StartUtc, long StartTimestamp,
        string Operation, string Target)
    {
        internal long ElapsedMilliseconds =>
            (long)Stopwatch.GetElapsedTime(StartTimestamp).TotalMilliseconds;
    }

    private sealed class CorrelationScope(string? prior) : IDisposable
    {
        public void Dispose() => Correlation.Value = prior;
    }
}

internal sealed class DiagnosticTimingScope : IDisposable
{
    private readonly ILogger logger;
    private readonly string operation;
    private readonly string detail;
    private readonly DateTimeOffset startUtc = DateTimeOffset.UtcNow;
    private readonly long started = Stopwatch.GetTimestamp();
    private int completed;

    internal DiagnosticTimingScope(ILogger logger, string operation, string detail)
    {
        this.logger = logger;
        this.operation = operation;
        this.detail = detail;
        logger.LogInformation(new EventId(3120, "DiagnosticStageStart"),
            "DiagnosticStageStart CorrelationId={CorrelationId} Operation={Operation} Detail={Detail} StartUtc={StartUtc}",
            DevDiagnosticTelemetry.CurrentCorrelationId, operation, detail, startUtc);
    }

    internal void Complete(string outcome)
    {
        if (Interlocked.Exchange(ref completed, 1) != 0) return;
        logger.LogInformation(new EventId(3121, "DiagnosticStageComplete"),
            "DiagnosticStageComplete CorrelationId={CorrelationId} Operation={Operation} Detail={Detail} StartUtc={StartUtc} ElapsedMs={ElapsedMs} Outcome={Outcome}",
            DevDiagnosticTelemetry.CurrentCorrelationId, operation, detail, startUtc,
            (long)Stopwatch.GetElapsedTime(started).TotalMilliseconds, outcome);
    }

    public void Dispose() => Complete("SCOPE_DISPOSED");
}
