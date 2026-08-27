using System.Diagnostics;
using System.Text;
using System.Text.Json;

const int maximumMessageBytes = 64 * 1024;
var browserOrigin = args.FirstOrDefault(argument => !argument.StartsWith("--", StringComparison.Ordinal));
NativeHostRequest? request = null;
NativeHostResponse response;
try
{
    if (!NativeHostContract.IsApprovedBrowserOrigin(browserOrigin))
        throw new NativeHostFailure("UnapprovedExtension", "Desktop folder access is unavailable.");

    var json = await ReadMessageAsync(Console.OpenStandardInput(), maximumMessageBytes);
    if (!NativeHostContract.TryParse(json, out request, out var contractFailure) || request is null)
        throw new NativeHostFailure(contractFailure, "The desktop folder request is invalid.");

    using var client = new DesktopCapabilityClient();
    var redemption = await client.RedeemAsync(request, CancellationToken.None);
    var resolver = new GovernedDrawingFolder(
        GovernedDrawingFolder.ApprovedRoot,
        new GovernedDesktopFileSystem());
    if (!resolver.TryResolve(redemption.RelativePath, out var target, out var pathFailure) || target is null)
        throw new NativeHostFailure(pathFailure, "The governed drawing folder is unavailable.");

    var explorer = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Windows), "explorer.exe");
    var start = new ProcessStartInfo(explorer) { UseShellExecute = false };
    start.ArgumentList.Add(target);
    if (Process.Start(start) is null)
        throw new NativeHostFailure("ExplorerLaunchFailed", "The drawing folder could not be opened.");

    response = new(NativeHostContract.Version, NativeHostContract.Operation,
        request.CorrelationId, true, "Opened", "Drawing folder opened.");
    BoundedAuditLog.Write(request.CorrelationId, true, "Opened");
}
catch (DesktopCapabilityException exception)
{
    var correlationId = request?.CorrelationId ?? "not-provided";
    response = new(NativeHostContract.Version, NativeHostContract.Operation,
        correlationId, false, exception.Category, "Desktop folder access is unavailable.");
    BoundedAuditLog.Write(correlationId, false, exception.Category);
}
catch (NativeHostFailure exception)
{
    var correlationId = request?.CorrelationId ?? "not-provided";
    response = new(NativeHostContract.Version, NativeHostContract.Operation,
        correlationId, false, exception.Category, exception.OperatorMessage);
    BoundedAuditLog.Write(correlationId, false, exception.Category);
}
catch (Exception)
{
    var correlationId = request?.CorrelationId ?? "not-provided";
    response = new(NativeHostContract.Version, NativeHostContract.Operation,
        correlationId, false, "UnexpectedFailure", "Desktop folder access is unavailable.");
    BoundedAuditLog.Write(correlationId, false, "UnexpectedFailure");
}
await WriteMessageAsync(Console.OpenStandardOutput(), response);

static async Task<string> ReadMessageAsync(Stream input, int maximumBytes)
{
    var header = new byte[4];
    await ReadExactlyAsync(input, header);
    var length = BitConverter.ToInt32(header, 0);
    if (length is <= 0 || length > maximumBytes)
        throw new NativeHostFailure("InvalidMessageLength", "The desktop folder request is invalid.");
    var payload = new byte[length];
    await ReadExactlyAsync(input, payload);
    return new UTF8Encoding(false, true).GetString(payload);
}

static async Task ReadExactlyAsync(Stream input, byte[] buffer)
{
    var offset = 0;
    while (offset < buffer.Length)
    {
        var read = await input.ReadAsync(buffer.AsMemory(offset));
        if (read == 0) throw new EndOfStreamException();
        offset += read;
    }
}

static async Task WriteMessageAsync(Stream output, NativeHostResponse response)
{
    var payload = JsonSerializer.SerializeToUtf8Bytes(response, new JsonSerializerOptions(JsonSerializerDefaults.Web));
    await output.WriteAsync(BitConverter.GetBytes(payload.Length));
    await output.WriteAsync(payload);
    await output.FlushAsync();
}

internal sealed class NativeHostFailure(string category, string operatorMessage) : Exception
{
    internal string Category { get; } = category;
    internal string OperatorMessage { get; } = operatorMessage;
}
