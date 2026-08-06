using System.Net;

const string approvedRoot = @"C:\DLE-OS\Repositories\DLE-OS\Artifacts\WorkOrderReleasedBom004\";
var root = Path.GetFullPath(args.Length > 0 ? args[0] : Path.Combine(approvedRoot, "WORKORDER-RELEASED-BOM-004"));
if (!root.StartsWith(approvedRoot, StringComparison.OrdinalIgnoreCase))
{
    throw new InvalidOperationException("Prototype server root is outside the approved development artifact scope.");
}

using var listener = new HttpListener();
listener.Prefixes.Add("http://127.0.0.1:8765/");
listener.Start();

while (listener.IsListening)
{
    var context = await listener.GetContextAsync();
    var relative = context.Request.Url?.AbsolutePath.TrimStart('/') ?? "index.html";
    if (string.IsNullOrWhiteSpace(relative)) relative = "index.html";
    var candidate = Path.GetFullPath(Path.Combine(root, Uri.UnescapeDataString(relative)));
    if (!candidate.StartsWith(root, StringComparison.OrdinalIgnoreCase) || !File.Exists(candidate))
    {
        context.Response.StatusCode = 404;
        context.Response.Close();
        continue;
    }

    var bytes = await File.ReadAllBytesAsync(candidate);
    context.Response.ContentType = candidate.EndsWith(".json", StringComparison.OrdinalIgnoreCase)
        ? "application/json; charset=utf-8"
        : "text/html; charset=utf-8";
    context.Response.ContentLength64 = bytes.Length;
    await context.Response.OutputStream.WriteAsync(bytes);
    context.Response.Close();
}
