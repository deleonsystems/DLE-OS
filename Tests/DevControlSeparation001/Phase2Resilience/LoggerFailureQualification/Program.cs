using System.Collections.Concurrent;
using System.Diagnostics;
using System.Net;
using Microsoft.Extensions.Logging;

if (DevJsonFileLoggerProvider.QueueCapacity != 4096 ||
    DevJsonFileLoggerProvider.MaximumBatchEntries != 128 ||
    DevJsonFileLoggerProvider.MaximumBatchDelayMilliseconds != 100 ||
    DevJsonFileLoggerProvider.GracefulShutdownDrainSeconds != 10 ||
    DevJsonFileLoggerProvider.AbsoluteShutdownSeconds != 15 ||
    DevJsonFileLoggerProvider.InitialWriterRetrySeconds != 5 ||
    DevJsonFileLoggerProvider.MaximumWriterRetrySeconds != 30 ||
    DevJsonFileLoggerProvider.MaximumFileBytes != 10L * 1024 * 1024 ||
    DevJsonFileLoggerProvider.MaximumArchiveFiles != 14 ||
    DevJsonFileLoggerProvider.RetentionDays != 14 ||
    DevJsonFileLoggerProvider.MaximumTotalBytes != 128L * 1024 * 1024)
    throw new InvalidOperationException("The reviewed logger constants are not exact.");

var results = new List<object>();
await QueueSaturation();
await SinkFailure("DISK_FULL", () => new DiskFullException());
await SinkFailure("ACCESS_DENIED", () => new UnauthorizedAccessException("qualification access denied"));
await SlowSink();
GracefulShutdown(0);
GracefulShutdown(128);
GracefulShutdown(4096);
FailedSinkShutdown();

Console.WriteLine(System.Text.Json.JsonSerializer.Serialize(new
{
    verdict = "PHASE2_LOGGER_FAILURE_QUALIFICATION_PASS",
    results
}, new System.Text.Json.JsonSerializerOptions { WriteIndented = true }));

async Task QueueSaturation()
{
    var root = NewRoot("saturation");
    var signals = new ConcurrentQueue<string>();
    var firstBatch = 1;
    using var provider = new DevJsonFileLoggerProvider(root, "queue-release", "queue-source",
        async (_, token) =>
        {
            if (Interlocked.Exchange(ref firstBatch, 0) == 1)
                await Task.Delay(TimeSpan.FromSeconds(10), token);
        },
        (category, _) => signals.Enqueue(category));
    var logger = provider.CreateLogger("Qualification.Queue");
    logger.LogInformation("QueueBlockTrigger Sequence={Sequence}", -1);
    await Task.Delay(250);

    using var health = new HealthServer(logger);
    var probes = health.ProbeContinuously(TimeSpan.FromSeconds(11));
    var timer = Stopwatch.StartNew();
    var producers = Enumerable.Range(0, 16).Select(producer => Task.Run(() =>
    {
        for (var index = 0; index < 512; index++)
            logger.LogInformation("QueueQualification Producer={Producer} Sequence={Sequence}", producer, index);
    })).ToArray();
    await Task.WhenAll(producers);
    timer.Stop();
    var saturated = provider.Snapshot;
    var probeResult = await probes;
    if (timer.Elapsed > TimeSpan.FromSeconds(5) || saturated.CurrentQueueDepth > 4096 ||
        saturated.DroppedEntries != 8193 - saturated.EnqueuedEntries ||
        saturated.DroppedEntries == 0 || saturated.State != DevLoggerHealthState.DegradedQueueFull ||
        !signals.Contains("QUEUE_FULL") || probeResult.Failures != 0 || probeResult.MaximumMilliseconds > 5000)
        throw new InvalidOperationException("Queue-saturation qualification failed: " +
            System.Text.Json.JsonSerializer.Serialize(new { producerMs = timer.ElapsedMilliseconds,
                saturated.CurrentQueueDepth, saturated.PeakQueueDepth, saturated.EnqueuedEntries,
                saturated.DroppedEntries, state = saturated.State.ToString(),
                queueSignal = signals.Contains("QUEUE_FULL"), probeResult }));
    provider.FlushForQualification();
    if (provider.Snapshot.State != DevLoggerHealthState.Healthy)
        throw new InvalidOperationException("Logger did not recover after queue saturation.");
    results.Add(new { test = "QueueSaturation", producerMilliseconds = timer.ElapsedMilliseconds,
        saturated.PeakQueueDepth, saturated.EnqueuedEntries, saturated.DroppedEntries,
        healthProbeCount = probeResult.Count, healthMaxMilliseconds = probeResult.MaximumMilliseconds });
    TryDelete(root);
}

async Task SinkFailure(string expectedCategory, Func<Exception> exceptionFactory)
{
    var root = NewRoot(expectedCategory);
    var fail = 1;
    var signals = new ConcurrentQueue<string>();
    using var provider = new DevJsonFileLoggerProvider(root, "failure-release", "failure-source",
        (_, _) => Volatile.Read(ref fail) == 1
            ? Task.FromException(exceptionFactory())
            : Task.CompletedTask,
        (category, _) => signals.Enqueue(category));
    var logger = provider.CreateLogger("Qualification.Failure");
    logger.LogInformation("SinkFailureQualification Category={Category}", expectedCategory);
    await WaitUntil(() => provider.Snapshot.State == DevLoggerHealthState.DegradedSinkUnavailable,
        TimeSpan.FromSeconds(2));
    if (provider.Snapshot.FailedBatches == 0 || provider.Snapshot.LastWriterErrorCategory != expectedCategory ||
        !signals.Contains(expectedCategory))
        throw new InvalidOperationException(expectedCategory + " degradation was not signaled.");
    Volatile.Write(ref fail, 0);
    await WaitUntil(() => provider.Snapshot.State == DevLoggerHealthState.Healthy,
        TimeSpan.FromSeconds(8));
    if (provider.Snapshot.WriterRecoveryCount == 0 || !signals.Contains("WRITER_RECOVERED"))
        throw new InvalidOperationException(expectedCategory + " recovery was not signaled.");
    results.Add(new { test = expectedCategory, provider.Snapshot.FailedBatches,
        provider.Snapshot.WriterRecoveryCount, state = provider.Snapshot.State.ToString() });
    TryDelete(root);
}

async Task SlowSink()
{
    var root = NewRoot("slow");
    var delays = 12;
    using var provider = new DevJsonFileLoggerProvider(root, "slow-release", "slow-source",
        async (_, token) =>
        {
            if (Interlocked.Decrement(ref delays) >= 0)
                await Task.Delay(TimeSpan.FromSeconds(5), token);
        }, (_, _) => { });
    var logger = provider.CreateLogger("Qualification.Slow");
    using var health = new HealthServer(logger);
    var probes = health.ProbeContinuously(TimeSpan.FromSeconds(61));
    var producerTimer = Stopwatch.StartNew();
    await Task.WhenAll(Enumerable.Range(0, 16).Select(producer => Task.Run(() =>
    {
        for (var index = 0; index < 512; index++)
            logger.LogInformation("SlowSinkQualification Producer={Producer} Sequence={Sequence}", producer, index);
    })));
    producerTimer.Stop();
    var peak = provider.Snapshot.PeakQueueDepth;
    var probeResult = await probes;
    if (producerTimer.Elapsed > TimeSpan.FromSeconds(5) || peak > 4096 ||
        probeResult.Failures != 0 || probeResult.MaximumMilliseconds > 5000)
        throw new InvalidOperationException("Slow-sink qualification failed.");
    provider.FlushForQualification();
    results.Add(new { test = "SlowSink", producerMilliseconds = producerTimer.ElapsedMilliseconds,
        peakQueueDepth = peak, provider.Snapshot.DroppedEntries,
        healthProbeCount = probeResult.Count, healthMaxMilliseconds = probeResult.MaximumMilliseconds });
    TryDelete(root);
}

void GracefulShutdown(int entries)
{
    var root = NewRoot("shutdown-" + entries);
    var provider = new DevJsonFileLoggerProvider(root, "shutdown-release", "shutdown-source", (_, _) => Task.CompletedTask,
        (_, _) => { });
    var logger = provider.CreateLogger("Qualification.Shutdown");
    for (var index = 0; index < entries; index++) logger.LogInformation("Shutdown Sequence={Sequence}", index);
    var expected = provider.Snapshot.EnqueuedEntries;
    var timer = Stopwatch.StartNew();
    provider.Dispose();
    timer.Stop();
    var snapshot = provider.Snapshot;
    if (timer.Elapsed > TimeSpan.FromSeconds(15) || snapshot.PersistedEntries != expected || snapshot.DroppedEntries != 0)
        throw new InvalidOperationException("Graceful shutdown qualification failed at depth " + entries + ".");
    results.Add(new { test = "GracefulShutdown", requestedEntries = entries,
        acceptedEntries = expected, elapsedMilliseconds = timer.ElapsedMilliseconds });
    TryDelete(root);
}

void FailedSinkShutdown()
{
    var root = NewRoot("failed-shutdown");
    var signals = new ConcurrentQueue<string>();
    var provider = new DevJsonFileLoggerProvider(root, "failed-shutdown-release", "failed-shutdown-source",
        (_, _) => Task.FromException(new IOException("qualification sink unavailable")),
        (category, _) => signals.Enqueue(category));
    provider.CreateLogger("Qualification.FailedShutdown").LogInformation("Failed shutdown trigger");
    Thread.Sleep(250);
    var timer = Stopwatch.StartNew();
    provider.Dispose();
    timer.Stop();
    if (timer.Elapsed > TimeSpan.FromSeconds(15) || provider.Snapshot.State != DevLoggerHealthState.Stopped ||
        provider.Snapshot.DroppedEntries == 0 || !signals.Contains("SHUTDOWN_DRAIN_TIMEOUT"))
        throw new InvalidOperationException("Failed-sink bounded shutdown qualification failed.");
    results.Add(new { test = "FailedSinkShutdown", elapsedMilliseconds = timer.ElapsedMilliseconds,
        provider.Snapshot.DroppedEntries });
    TryDelete(root);
}

static string NewRoot(string name)
{
    var path = Path.Combine(Path.GetTempPath(), "dle-os-logger-" + name + "-" + Guid.NewGuid().ToString("N"));
    Directory.CreateDirectory(path);
    return path;
}

static void TryDelete(string root)
{
    try { if (Directory.Exists(root)) Directory.Delete(root, true); } catch { }
}

static async Task WaitUntil(Func<bool> predicate, TimeSpan timeout)
{
    var deadline = DateTime.UtcNow + timeout;
    while (!predicate())
    {
        if (DateTime.UtcNow >= deadline) throw new TimeoutException("Qualification condition timed out.");
        await Task.Delay(25);
    }
}

sealed class DiskFullException : IOException
{
    internal DiskFullException() : base("qualification disk full") => HResult = unchecked((int)0x80070070);
}

sealed class HealthServer : IDisposable
{
    private readonly System.Net.Sockets.TcpListener listener;
    private readonly CancellationTokenSource stop = new();
    private readonly Task server;
    private readonly ILogger logger;
    internal Uri Uri { get; }

    internal HealthServer(ILogger logger)
    {
        this.logger = logger;
        listener = new System.Net.Sockets.TcpListener(IPAddress.Loopback, 0);
        listener.Start();
        var port = ((IPEndPoint)listener.LocalEndpoint).Port;
        Uri = new Uri($"http://127.0.0.1:{port}/health/");
        server = Task.Run(ServerLoop);
    }

    internal async Task<(int Count, int Failures, long MaximumMilliseconds)> ProbeContinuously(TimeSpan duration)
    {
        using var client = new HttpClient { Timeout = TimeSpan.FromSeconds(5) };
        var deadline = DateTime.UtcNow + duration;
        var count = 0;
        var failures = 0;
        long maximum = 0;
        while (DateTime.UtcNow < deadline)
        {
            var timer = Stopwatch.StartNew();
            try
            {
                using var response = await client.GetAsync(Uri);
                if (response.StatusCode != HttpStatusCode.OK) failures++;
            }
            catch { failures++; }
            timer.Stop();
            maximum = Math.Max(maximum, timer.ElapsedMilliseconds);
            count++;
            await Task.Delay(100);
        }
        return (count, failures, maximum);
    }

    private async Task ServerLoop()
    {
        while (!stop.IsCancellationRequested)
        {
            try
            {
                using var client = await listener.AcceptTcpClientAsync(stop.Token);
                await using var stream = client.GetStream();
                var request = new byte[2048];
                _ = await stream.ReadAsync(request, stop.Token);
                var response = System.Text.Encoding.ASCII.GetBytes(
                    "HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\nOK");
                await stream.WriteAsync(response, stop.Token);
            }
            catch (OperationCanceledException) { break; }
            catch (System.Net.Sockets.SocketException) when (stop.IsCancellationRequested) { break; }
        }
    }

    public void Dispose()
    {
        stop.Cancel();
        listener.Stop();
        try { server.Wait(TimeSpan.FromSeconds(2)); } catch { }
        stop.Dispose();
    }
}
