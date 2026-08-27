using System.Text.Json;

internal static class BoundedAuditLog
{
    private const long MaximumBytes = 1024 * 1024;
    private static readonly object Sync = new();

    internal static void Write(string correlationId, bool success, string category)
    {
        try
        {
            lock (Sync)
            {
                var root = Path.Combine(
                    Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                    "DLE-OS", "GovernedDesktopCapabilities", "DEV", "logs");
                Directory.CreateDirectory(root);
                var path = Path.Combine(root, "desktop-capabilities.jsonl");
                if (File.Exists(path) && new FileInfo(path).Length >= MaximumBytes)
                {
                    var prior = path + ".1";
                    if (File.Exists(prior)) File.Delete(prior);
                    File.Move(path, prior);
                }
                var record = new
                {
                    timestampUtc = DateTimeOffset.UtcNow,
                    correlationId,
                    operation = NativeHostContract.Operation,
                    success,
                    category,
                    user = Environment.UserName,
                    sessionId = Environment.ProcessId > 0 ? System.Diagnostics.Process.GetCurrentProcess().SessionId : -1
                };
                File.AppendAllText(path, JsonSerializer.Serialize(record) + Environment.NewLine);
            }
        }
        catch
        {
            // Audit failure must not expose tokens or turn the host into a generic error surface.
        }
    }
}
