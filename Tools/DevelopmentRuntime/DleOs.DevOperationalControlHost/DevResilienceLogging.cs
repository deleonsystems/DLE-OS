using System.Collections.Concurrent;
using System.Diagnostics;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.Extensions.Logging;

internal sealed class DevJsonFileLoggerProvider : ILoggerProvider, ISupportExternalScope
{
    internal const long MaximumFileBytes = 10L * 1024 * 1024;
    internal const long MaximumTotalBytes = 128L * 1024 * 1024;
    internal const int MaximumArchiveFiles = 14;
    internal const int RetentionDays = 14;

    private readonly ConcurrentDictionary<string, DevJsonFileLogger> _loggers = new(StringComparer.Ordinal);
    private readonly string _logRoot;
    private readonly string _releaseId;
    private readonly string _sourceIdentity;
    private readonly object _writeLock = new();
    private IExternalScopeProvider _scopes = new LoggerExternalScopeProvider();
    private int _writesSinceRetention;

    internal DevJsonFileLoggerProvider(string logRoot, string releaseId, string sourceIdentity)
    {
        _logRoot = Path.GetFullPath(logRoot);
        _releaseId = SafeValue(releaseId, 160);
        _sourceIdentity = SafeValue(sourceIdentity, 160);
        Directory.CreateDirectory(_logRoot);
        ApplyRetention();
    }

    public ILogger CreateLogger(string categoryName) =>
        _loggers.GetOrAdd(categoryName, category => new DevJsonFileLogger(category, this));

    public void SetScopeProvider(IExternalScopeProvider scopeProvider) => _scopes = scopeProvider;
    public void Dispose() => _loggers.Clear();

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

        lock (_writeLock)
        {
            Directory.CreateDirectory(_logRoot);
            var activePath = Path.Combine(_logRoot, "dev5054-current.jsonl");
            if (File.Exists(activePath) && new FileInfo(activePath).Length + bytes.Length > MaximumFileBytes)
            {
                var archive = Path.Combine(_logRoot,
                    $"dev5054-{DateTimeOffset.UtcNow:yyyyMMddTHHmmssfffZ}-{Guid.NewGuid():N}.jsonl");
                File.Move(activePath, archive);
            }
            using var stream = new FileStream(activePath, FileMode.Append, FileAccess.Write, FileShare.ReadWrite);
            stream.Write(bytes, 0, bytes.Length);
            stream.Flush(true);
            if (++_writesSinceRetention >= 100)
            {
                _writesSinceRetention = 0;
                ApplyRetention();
            }
        }
    }

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

internal sealed class DevJsonFileLogger(string category, DevJsonFileLoggerProvider provider) : ILogger
{
    public IDisposable? BeginScope<TState>(TState state) where TState : notnull => provider.PushScope(state);
    public bool IsEnabled(LogLevel logLevel) => logLevel >= LogLevel.Information;
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
        var stopwatch = Stopwatch.StartNew();
        try
        {
            await next(context);
            var actor = context.User.Identity?.IsAuthenticated == true ? context.User.Identity.Name : null;
            var level = context.Response.StatusCode is 401 or 403 ? LogLevel.Warning : LogLevel.Information;
            logger.Log(level, new EventId(2001, "RequestCompleted"),
                "RequestCompleted CorrelationId={CorrelationId} Actor={Actor} Method={Method} Route={Route} Status={Status} DurationMs={DurationMs}",
                correlationId, actor ?? "ANONYMOUS", context.Request.Method, context.Request.Path.Value,
                context.Response.StatusCode, stopwatch.ElapsedMilliseconds);
        }
        catch (Exception exception)
        {
            logger.LogError(new EventId(2500, "RequestFailed"), exception,
                "RequestFailed Classification={Classification} CorrelationId={CorrelationId} Actor={Actor} Method={Method} Route={Route} DurationMs={DurationMs}",
                Classify(exception), correlationId, context.User.Identity?.Name ?? "ANONYMOUS",
                context.Request.Method, context.Request.Path.Value, stopwatch.ElapsedMilliseconds);
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
