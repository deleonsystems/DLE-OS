using System.Collections.Concurrent;
using System.Diagnostics;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using System.Threading.Channels;
using System.Runtime.InteropServices;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.Logging;

internal enum DevLoggerHealthState
{
    Healthy,
    DegradedQueueFull,
    DegradedSinkUnavailable,
    Recovering,
    Stopped
}

internal sealed record DevLoggerHealthSnapshot(
    DevLoggerHealthState State,
    int CurrentQueueDepth,
    int PeakQueueDepth,
    long EnqueuedEntries,
    long PersistedEntries,
    long DroppedEntries,
    long FailedBatches,
    DateTimeOffset? LastSuccessfulFlushUtc,
    string? LastWriterErrorCategory,
    DateTimeOffset? LastWriterErrorUtc,
    long WriterRecoveryCount);

internal sealed class DevJsonFileLoggerProvider : ILoggerProvider, ISupportExternalScope
{
    internal const long MaximumFileBytes = 10L * 1024 * 1024;
    internal const long MaximumTotalBytes = 128L * 1024 * 1024;
    internal const int MaximumArchiveFiles = 14;
    internal const int RetentionDays = 14;
    internal const int QueueCapacity = 4096;
    internal const int MaximumBatchEntries = 128;
    internal const int MaximumBatchDelayMilliseconds = 100;
    internal const int GracefulShutdownDrainSeconds = 10;
    internal const int AbsoluteShutdownSeconds = 15;
    internal const int InitialWriterRetrySeconds = 5;
    internal const int MaximumWriterRetrySeconds = 30;
    internal const int IndependentSignalRateSeconds = 60;

    private readonly ConcurrentDictionary<string, DevJsonFileLogger> _loggers = new(StringComparer.Ordinal);
    private readonly string _logRoot;
    private readonly string _releaseId;
    private readonly string _sourceIdentity;
    private readonly Channel<QueuedLogEntry> _queue;
    private readonly Task _writer;
    private readonly CancellationTokenSource _forceStop = new();
    private readonly Func<IReadOnlyList<byte[]>, CancellationToken, Task> _batchWriter;
    private readonly Action<string, string> _independentSignal;
    private readonly ConcurrentDictionary<string, long> _lastSignalTicks = new(StringComparer.Ordinal);
    private IExternalScopeProvider _scopes = new LoggerExternalScopeProvider();
    private int _writesSinceRetention;
    private int _queueDepth;
    private int _peakQueueDepth;
    private int _activeBatchEntries;
    private long _enqueuedEntries;
    private long _persistedEntries;
    private long _droppedEntries;
    private long _failedBatches;
    private long _lastSuccessfulFlushUtcTicks;
    private string? _lastWriterErrorCategory;
    private long _lastWriterErrorUtcTicks;
    private long _writerRecoveryCount;
    private int _healthState = (int)DevLoggerHealthState.Healthy;
    private int _disposed;

    internal DevJsonFileLoggerProvider(string logRoot, string releaseId, string sourceIdentity,
        Func<IReadOnlyList<byte[]>, CancellationToken, Task>? batchWriter = null,
        Action<string, string>? independentSignal = null)
    {
        _logRoot = Path.GetFullPath(logRoot);
        _releaseId = SafeValue(releaseId, 160);
        _sourceIdentity = SafeValue(sourceIdentity, 160);
        Directory.CreateDirectory(_logRoot);
        ApplyRetention();
        _queue = Channel.CreateBounded<QueuedLogEntry>(new BoundedChannelOptions(QueueCapacity)
        {
            SingleReader = true,
            SingleWriter = false,
            FullMode = BoundedChannelFullMode.Wait,
            AllowSynchronousContinuations = false
        });
        _batchWriter = batchWriter ?? WriteBatchAsync;
        _independentSignal = independentSignal ?? DevWindowsApplicationSignal.TryWrite;
        _writer = Task.Run(WriterLoopAsync);
    }

    public ILogger CreateLogger(string categoryName) =>
        _loggers.GetOrAdd(categoryName, category => new DevJsonFileLogger(category, this));

    public void SetScopeProvider(IExternalScopeProvider scopeProvider) => _scopes = scopeProvider;
    public void Dispose()
    {
        if (Interlocked.Exchange(ref _disposed, 1) != 0) return;
        _queue.Writer.TryComplete();
        try
        {
            if (!_writer.Wait(TimeSpan.FromSeconds(GracefulShutdownDrainSeconds)))
            {
                Signal("SHUTDOWN_DRAIN_TIMEOUT", "Logger drain exceeded ten seconds; forcing bounded shutdown.");
                _forceStop.Cancel();
                _writer.Wait(TimeSpan.FromSeconds(AbsoluteShutdownSeconds - GracefulShutdownDrainSeconds));
            }
        }
        catch (AggregateException) { }
        finally
        {
            var lost = Interlocked.Exchange(ref _activeBatchEntries, 0);
            while (_queue.Reader.TryRead(out var pending))
            {
                Interlocked.Decrement(ref _queueDepth);
                if (pending.Bytes is not null) lost++;
                pending.Barrier?.Set();
            }
            if (lost > 0) Interlocked.Add(ref _droppedEntries, lost);
            TransitionTo(DevLoggerHealthState.Stopped, "LOGGER_STOPPED",
                $"Logger stopped. UndrainedEntries={lost}.", false);
            _forceStop.Dispose();
        }
        _loggers.Clear();
    }

    internal IDisposable? PushScope<TState>(TState state) where TState : notnull => _scopes.Push(state);

    internal void Write<TState>(string category, LogLevel level, EventId eventId, TState state,
        Exception? exception, Func<TState, Exception?, string> formatter)
    {
        var properties = new Dictionary<string, object?>(StringComparer.OrdinalIgnoreCase);
        if (state is IEnumerable<KeyValuePair<string, object?>> values)
        {
            foreach (var item in values)
            {
                if (item.Key == "{OriginalFormat}") continue;
                properties[item.Key] = IsSensitiveKey(item.Key) ? "[REDACTED]" : SafeObject(item.Value);
            }
        }

        var scopes = new List<object?>();
        _scopes.ForEachScope((scope, list) => list.Add(SafeObject(scope)), scopes);
        var entry = new Dictionary<string, object?>
        {
            ["timestampUtc"] = DateTimeOffset.UtcNow.ToString("O"),
            ["level"] = level.ToString(),
            ["category"] = SafeValue(category, 300),
            ["eventId"] = eventId.Id,
            ["eventName"] = eventId.Name,
            ["message"] = SafeValue(formatter(state, exception), 4096),
            ["releaseId"] = _releaseId,
            ["sourceIdentity"] = _sourceIdentity,
            ["processId"] = Environment.ProcessId,
            ["executionIdentity"] = Environment.UserDomainName + @"\" + Environment.UserName,
            ["properties"] = properties.Count == 0 ? null : properties,
            ["scopes"] = scopes.Count == 0 ? null : scopes,
            ["exceptionType"] = exception?.GetType().FullName,
            ["exceptionSummary"] = exception is null ? null : SafeValue(exception.Message, 2048)
        };
        var payload = JsonSerializer.Serialize(entry) + Environment.NewLine;
        var bytes = Encoding.UTF8.GetBytes(payload);

        TryEnqueue(bytes, countDrop: true);
    }

    internal void FlushForQualification()
    {
        if (Volatile.Read(ref _disposed) != 0) return;
        using var completed = new ManualResetEventSlim(false);
        var deadline = DateTime.UtcNow.AddSeconds(GracefulShutdownDrainSeconds);
        while (!_queue.Writer.TryWrite(new(null, completed)))
        {
            if (DateTime.UtcNow >= deadline)
                throw new TimeoutException("The bounded DEV JSON logger could not enqueue a drain barrier.");
            Thread.Sleep(10);
        }
        IncrementQueueDepth();
        if (!completed.Wait(TimeSpan.FromSeconds(10)))
            throw new TimeoutException("The bounded DEV JSON logger did not drain within ten seconds.");
    }

    internal long DroppedEntryCount => Interlocked.Read(ref _droppedEntries);
    internal DevLoggerHealthSnapshot Snapshot => new(
        (DevLoggerHealthState)Volatile.Read(ref _healthState),
        Volatile.Read(ref _queueDepth),
        Volatile.Read(ref _peakQueueDepth),
        Interlocked.Read(ref _enqueuedEntries),
        Interlocked.Read(ref _persistedEntries),
        Interlocked.Read(ref _droppedEntries),
        Interlocked.Read(ref _failedBatches),
        ReadUtc(ref _lastSuccessfulFlushUtcTicks),
        Volatile.Read(ref _lastWriterErrorCategory),
        ReadUtc(ref _lastWriterErrorUtcTicks),
        Interlocked.Read(ref _writerRecoveryCount));

    private async Task WriterLoopAsync()
    {
        var batch = new List<byte[]>(MaximumBatchEntries);
        try
        {
            await foreach (var first in _queue.Reader.ReadAllAsync(_forceStop.Token))
            {
                Interlocked.Decrement(ref _queueDepth);
                if (first.Barrier is not null)
                {
                    first.Barrier.Set();
                    continue;
                }
                if (first.Bytes is not null) batch.Add(first.Bytes);

                await Task.Delay(MaximumBatchDelayMilliseconds, _forceStop.Token).ConfigureAwait(false);
                while (batch.Count < MaximumBatchEntries && _queue.Reader.TryRead(out var next))
                {
                    Interlocked.Decrement(ref _queueDepth);
                    if (next.Barrier is not null)
                    {
                        await PersistWithRetryAsync(batch, _forceStop.Token).ConfigureAwait(false);
                        batch.Clear();
                        next.Barrier.Set();
                    }
                    else if (next.Bytes is not null)
                    {
                        batch.Add(next.Bytes);
                    }
                }
                await PersistWithRetryAsync(batch, _forceStop.Token).ConfigureAwait(false);
                batch.Clear();
            }
        }
        catch (OperationCanceledException) when (_forceStop.IsCancellationRequested) { }
        finally
        {
            if (!_forceStop.IsCancellationRequested && batch.Count > 0)
                await PersistWithRetryAsync(batch, CancellationToken.None).ConfigureAwait(false);
        }
    }

    private async Task PersistWithRetryAsync(List<byte[]> batch, CancellationToken cancellationToken)
    {
        if (batch.Count == 0) return;
        Volatile.Write(ref _activeBatchEntries, batch.Count);
        var retrySeconds = InitialWriterRetrySeconds;
        var recovering = false;
        while (!cancellationToken.IsCancellationRequested)
        {
            try
            {
                await _batchWriter(batch, cancellationToken).ConfigureAwait(false);
                Interlocked.Add(ref _persistedEntries, batch.Count);
                Interlocked.Exchange(ref _lastSuccessfulFlushUtcTicks, DateTimeOffset.UtcNow.UtcTicks);
                Volatile.Write(ref _activeBatchEntries, 0);
                var prior = (DevLoggerHealthState)Volatile.Read(ref _healthState);
                if (prior is DevLoggerHealthState.DegradedSinkUnavailable or DevLoggerHealthState.DegradedQueueFull || recovering)
                {
                    TransitionTo(DevLoggerHealthState.Recovering, "WRITER_RECOVERING",
                        "DEV JSON logger sink accepted a batch after degradation.");
                    Interlocked.Increment(ref _writerRecoveryCount);
                    TransitionTo(DevLoggerHealthState.Healthy, "WRITER_RECOVERED",
                        "DEV JSON logger returned to Healthy.");
                }
                return;
            }
            catch (Exception error) when (error is not OperationCanceledException)
            {
                recovering = true;
                Interlocked.Increment(ref _failedBatches);
                var category = ClassifyWriterError(error);
                Volatile.Write(ref _lastWriterErrorCategory, category);
                Interlocked.Exchange(ref _lastWriterErrorUtcTicks, DateTimeOffset.UtcNow.UtcTicks);
                TransitionTo(DevLoggerHealthState.DegradedSinkUnavailable, category,
                    $"DEV JSON logger sink unavailable. Category={category}; Exception={error.GetType().FullName}.");
                try
                {
                    await Task.Delay(TimeSpan.FromSeconds(retrySeconds), cancellationToken).ConfigureAwait(false);
                }
                catch (OperationCanceledException) { break; }
                retrySeconds = Math.Min(retrySeconds * 2, MaximumWriterRetrySeconds);
            }
        }
    }

    private Task WriteBatchAsync(IReadOnlyList<byte[]> batch, CancellationToken cancellationToken)
    {
        if (batch.Count == 0) return Task.CompletedTask;
        cancellationToken.ThrowIfCancellationRequested();
        Directory.CreateDirectory(_logRoot);
        var activePath = Path.Combine(_logRoot, "dev5054-current.jsonl");
        var batchBytes = batch.Sum(value => (long)value.Length);
        if (File.Exists(activePath) && new FileInfo(activePath).Length + batchBytes > MaximumFileBytes)
        {
            var archive = Path.Combine(_logRoot,
                $"dev5054-{DateTimeOffset.UtcNow:yyyyMMddTHHmmssfffZ}-{Guid.NewGuid():N}.jsonl");
            File.Move(activePath, archive);
        }
        using var stream = new FileStream(activePath, FileMode.Append, FileAccess.Write, FileShare.ReadWrite);
        foreach (var bytes in batch) stream.Write(bytes, 0, bytes.Length);
        stream.Flush(true);
        _writesSinceRetention += batch.Count;
        if (_writesSinceRetention >= 100)
        {
            _writesSinceRetention = 0;
            ApplyRetention();
        }
        return Task.CompletedTask;
    }

    private bool TryEnqueue(byte[] bytes, bool countDrop)
    {
        if (Volatile.Read(ref _disposed) != 0 || !_queue.Writer.TryWrite(new(bytes, null)))
        {
            if (countDrop)
            {
                Interlocked.Increment(ref _droppedEntries);
                TransitionTo(DevLoggerHealthState.DegradedQueueFull, "QUEUE_FULL",
                    "DEV JSON logger queue is full; newest entry was rejected.", false);
            }
            return false;
        }
        Interlocked.Increment(ref _enqueuedEntries);
        IncrementQueueDepth();
        return true;
    }

    private void IncrementQueueDepth()
    {
        var depth = Interlocked.Increment(ref _queueDepth);
        while (true)
        {
            var peak = Volatile.Read(ref _peakQueueDepth);
            if (depth <= peak || Interlocked.CompareExchange(ref _peakQueueDepth, depth, peak) == peak) break;
        }
    }

    private void TransitionTo(DevLoggerHealthState state, string category, string message, bool persist = true)
    {
        var prior = (DevLoggerHealthState)Interlocked.Exchange(ref _healthState, (int)state);
        if (prior == state && state != DevLoggerHealthState.DegradedSinkUnavailable) return;
        Signal(category, message);
        if (persist && state != DevLoggerHealthState.Stopped)
        {
            var snapshot = Snapshot;
            var entry = JsonSerializer.Serialize(new
            {
                timestampUtc = DateTimeOffset.UtcNow.ToString("O"),
                level = state == DevLoggerHealthState.Healthy ? "Information" : "Warning",
                category = "DleOs.Dev5054.LoggerHealth",
                eventId = 4000,
                eventName = "LoggerHealthTransition",
                releaseId = _releaseId,
                sourceIdentity = _sourceIdentity,
                processId = Environment.ProcessId,
                executionIdentity = Environment.UserDomainName + @"\" + Environment.UserName,
                properties = snapshot
            }) + Environment.NewLine;
            TryEnqueue(Encoding.UTF8.GetBytes(entry), countDrop: false);
        }
    }

    private void Signal(string category, string message)
    {
        var now = DateTimeOffset.UtcNow.UtcTicks;
        var prior = _lastSignalTicks.GetOrAdd(category, 0);
        if (prior != 0 && new TimeSpan(now - prior) < TimeSpan.FromSeconds(IndependentSignalRateSeconds)) return;
        if (!_lastSignalTicks.TryUpdate(category, now, prior)) return;
        try { _independentSignal(category, message); } catch { }
    }

    private static string ClassifyWriterError(Exception error)
    {
        if (error is UnauthorizedAccessException) return "ACCESS_DENIED";
        if (error is IOException io && (io.HResult & 0xFFFF) is 39 or 112) return "DISK_FULL";
        if (error is IOException) return "IO_FAILURE";
        return "SINK_FAILURE";
    }

    private static DateTimeOffset? ReadUtc(ref long ticks)
    {
        var value = Interlocked.Read(ref ticks);
        return value == 0 ? null : new DateTimeOffset(value, TimeSpan.Zero);
    }

    private sealed record QueuedLogEntry(byte[]? Bytes, ManualResetEventSlim? Barrier);

    private void ApplyRetention()
    {
        var cutoff = DateTime.UtcNow.AddDays(-RetentionDays);
        var archives = Directory.EnumerateFiles(_logRoot, "dev5054-*.jsonl", SearchOption.TopDirectoryOnly)
            .Where(path => !path.EndsWith("dev5054-current.jsonl", StringComparison.OrdinalIgnoreCase))
            .Select(path => new FileInfo(path)).OrderByDescending(file => file.LastWriteTimeUtc).ToList();
        foreach (var expired in archives.Where(file => file.LastWriteTimeUtc < cutoff).ToArray())
        {
            TryDelete(expired.FullName);
            archives.Remove(expired);
        }
        while (archives.Count > MaximumArchiveFiles)
        {
            var oldest = archives[^1];
            TryDelete(oldest.FullName);
            archives.RemoveAt(archives.Count - 1);
        }
        long total = archives.Where(file => file.Exists).Sum(file => file.Length);
        var active = new FileInfo(Path.Combine(_logRoot, "dev5054-current.jsonl"));
        if (active.Exists) total += active.Length;
        while (total > MaximumTotalBytes && archives.Count > 0)
        {
            var oldest = archives[^1];
            total -= oldest.Exists ? oldest.Length : 0;
            TryDelete(oldest.FullName);
            archives.RemoveAt(archives.Count - 1);
        }
    }

    private static void TryDelete(string path)
    {
        try { File.Delete(path); } catch (IOException) { } catch (UnauthorizedAccessException) { }
    }

    private static bool IsSensitiveKey(string key) => Regex.IsMatch(key,
        "password|passwd|pwd|token|secret|credential|authorization|private.?key|assertion", RegexOptions.IgnoreCase);

    private static object? SafeObject(object? value)
    {
        if (value is null) return null;
        if (value is string text) return SafeValue(text, 2048);
        if (value is DateTime or DateTimeOffset or Guid || value.GetType().IsPrimitive || value is decimal) return value;
        return SafeValue(value.ToString() ?? string.Empty, 2048);
    }

    private static string SafeValue(string value, int maximumLength)
    {
        var sanitized = Regex.Replace(value,
            "(?i)(password|passwd|pwd|token|secret|credential|authorization|assertion)\\s*[:=]\\s*[^\\s,;]+",
            "$1=[REDACTED]");
        return sanitized.Length <= maximumLength ? sanitized : sanitized[..maximumLength];
    }
}

internal static class DevWindowsApplicationSignal
{
    private const ushort EventLogErrorType = 0x0001;
    private const ushort EventLogWarningType = 0x0002;

    internal static void TryWrite(string category, string message)
    {
        if (!OperatingSystem.IsWindows()) return;
        var handle = RegisterEventSource(null, "DLE-OS DEV 5054 Logger");
        if (handle == IntPtr.Zero) return;
        try
        {
            var text = $"Category={category}; {message}";
            var strings = new[] { text.Length <= 3000 ? text : text[..3000] };
            _ = ReportEvent(handle,
                category.Contains("RECOVER", StringComparison.OrdinalIgnoreCase)
                    ? EventLogWarningType
                    : EventLogErrorType,
                0, 50540, IntPtr.Zero, 1, 0, strings, IntPtr.Zero);
        }
        finally
        {
            DeregisterEventSource(handle);
        }
    }

    [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern IntPtr RegisterEventSource(string? serverName, string sourceName);

    [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool ReportEvent(IntPtr eventLog, ushort eventType, ushort category,
        uint eventId, IntPtr userSid, ushort stringCount, uint dataSize,
        [MarshalAs(UnmanagedType.LPArray, ArraySubType = UnmanagedType.LPWStr)] string[] strings,
        IntPtr rawData);

    [DllImport("advapi32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool DeregisterEventSource(IntPtr eventLog);
}

internal sealed class DevJsonFileLogger(string category, DevJsonFileLoggerProvider provider) : ILogger
{
    public IDisposable? BeginScope<TState>(TState state) where TState : notnull => provider.PushScope(state);
    public bool IsEnabled(LogLevel logLevel) => logLevel >= LogLevel.Information &&
        (!(category.StartsWith("Microsoft.", StringComparison.Ordinal) ||
           category.StartsWith("System.", StringComparison.Ordinal)) || logLevel >= LogLevel.Warning);
    public void Log<TState>(LogLevel logLevel, EventId eventId, TState state, Exception? exception,
        Func<TState, Exception?, string> formatter)
    {
        if (IsEnabled(logLevel)) provider.Write(category, logLevel, eventId, state, exception, formatter);
    }
}

internal static class DevRequestLogging
{
    private static readonly Regex SafeCorrelation = new("^[A-Za-z0-9._:-]{1,128}$", RegexOptions.Compiled);

    internal static async Task InvokeAsync(HttpContext context, RequestDelegate next, ILogger logger)
    {
        var supplied = context.Request.Headers["X-DLE-OS-Correlation-ID"].FirstOrDefault();
        var correlationId = supplied is not null && SafeCorrelation.IsMatch(supplied)
            ? supplied
            : Guid.NewGuid().ToString("D");
        context.TraceIdentifier = correlationId;
        context.Response.Headers["X-DLE-OS-Correlation-ID"] = correlationId;
#if DLE_OS_DEV_ONLY
        using var correlationScope = DevDiagnosticTelemetry.PushCorrelation(correlationId);
        using var diagnosticStage = DevDiagnosticTelemetry.BeginEnrichmentStage(context.Request.Path);
#endif
        var stopwatch = Stopwatch.StartNew();
        try
        {
            await next(context);
#if DLE_OS_DEV_ONLY
            diagnosticStage?.Complete("HTTP_" + context.Response.StatusCode);
#endif
            var actor = context.User.Identity?.IsAuthenticated == true ? context.User.Identity.Name : null;
            var level = context.Response.StatusCode is 401 or 403 ? LogLevel.Warning : LogLevel.Information;
            var route = (context.GetEndpoint() as RouteEndpoint)?.RoutePattern.RawText ?? "UNMATCHED_ROUTE";
            logger.Log(level, new EventId(2001, "RequestCompleted"),
                "RequestCompleted CorrelationId={CorrelationId} Actor={Actor} Method={Method} Route={Route} Status={Status} DurationMs={DurationMs}",
                correlationId, actor ?? "ANONYMOUS", context.Request.Method, route,
                context.Response.StatusCode, stopwatch.ElapsedMilliseconds);
            if (stopwatch.ElapsedMilliseconds > 5000)
                logger.LogWarning(new EventId(2201, "SlowRequest"),
                    "SlowRequest CorrelationId={CorrelationId} Method={Method} Route={Route} Status={Status} DurationMs={DurationMs}",
                    correlationId, context.Request.Method, route, context.Response.StatusCode,
                    stopwatch.ElapsedMilliseconds);
        }
        catch (Exception exception)
        {
#if DLE_OS_DEV_ONLY
            diagnosticStage?.Complete("EXCEPTION_" + exception.GetType().Name);
#endif
            logger.LogError(new EventId(2500, "RequestFailed"), exception,
                "RequestFailed Classification={Classification} CorrelationId={CorrelationId} Actor={Actor} Method={Method} Route={Route} DurationMs={DurationMs}",
                Classify(exception), correlationId, context.User.Identity?.Name ?? "ANONYMOUS",
                context.Request.Method,
                (context.GetEndpoint() as RouteEndpoint)?.RoutePattern.RawText ?? "UNMATCHED_ROUTE",
                stopwatch.ElapsedMilliseconds);
            throw;
        }
    }

    internal static string Classify(Exception exception)
    {
        var name = exception.GetType().FullName ?? exception.GetType().Name;
        if (name.Contains("Sql", StringComparison.OrdinalIgnoreCase)) return "DATABASE_CONNECTIVITY_OR_OPERATION";
        if (name.Contains("HttpRequest", StringComparison.OrdinalIgnoreCase)) return "CANONICAL_5052_DEPENDENCY";
        if (name.Contains("Unauthorized", StringComparison.OrdinalIgnoreCase)) return "AUTHENTICATION_OR_PERMISSION";
        return "APPLICATION_ERROR";
    }
}
