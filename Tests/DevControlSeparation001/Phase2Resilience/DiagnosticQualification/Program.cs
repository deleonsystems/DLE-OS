using System.Diagnostics;
using System.Net;
using Microsoft.Data.SqlClient;
using Microsoft.Extensions.FileProviders;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

var root = Path.Combine(Path.GetTempPath(), "dle-os-dev5054-diagnostic-" + Guid.NewGuid().ToString("N"));
Directory.CreateDirectory(root);
try
{
    using var provider = new DevJsonFileLoggerProvider(root, "dev5054-diagnostic-test", "source-test");
    using var loggerFactory = LoggerFactory.Create(builder => builder.AddProvider(provider));
    using var telemetry = DevDiagnosticTelemetry.Start(loggerFactory, new QualificationEnvironment(root),
        "dev5054-diagnostic-test", "http://DLE-OS-HOST:5052");
    using var correlation = DevDiagnosticTelemetry.PushCorrelation("diagnostic-correlation-001");

    using (var permission = DevDiagnosticTelemetry.BeginPermissionResolution("kitting.view"))
        permission?.Complete("ALLOW");
    using (var stage = DevDiagnosticTelemetry.BeginEnrichmentStage(
               new PathString("/api/work-order-approvals/v1/sales-order-lines/QUALIFICATION")))
        stage?.Complete("HTTP_200");

    using var httpListener = new DiagnosticListener("HttpHandlerDiagnosticListener");
    using var request = new HttpRequestMessage(HttpMethod.Get,
        "http://DLE-OS-HOST:5052/api/platform/live/v1/sales-orders/QUALIFICATION");
    httpListener.Write("System.Net.Http.HttpRequestOut.Start", new { Request = request });
    using var response = new HttpResponseMessage(HttpStatusCode.OK);
    httpListener.Write("System.Net.Http.HttpRequestOut.Stop", new { Request = request, Response = response });
    using var canceledRequest = new HttpRequestMessage(HttpMethod.Get,
        "http://DLE-OS-HOST:5052/api/platform/live/v1/work-orders?page=1&pageSize=1");
    httpListener.Write("System.Net.Http.HttpRequestOut.Start", new { Request = canceledRequest });
    httpListener.Write("System.Net.Http.HttpRequestOut.Exception",
        new { Request = canceledRequest, Exception = new TaskCanceledException("qualification cancellation") });

    using var sqlListener = new DiagnosticListener("Microsoft.Data.SqlClientDiagnosticListener");
    var operationId = Guid.NewGuid();
    using var connection = new SqlConnection(
        "Server=lpc:.\\SQLEXPRESS;Database=DLE_OS_SECURITY_DEV;Integrated Security=True;Encrypt=False");
    using var command = new SqlCommand("SELECT u.UserId FROM security.[User] u WHERE u.UserId=@UserId;", connection);
    sqlListener.Write("Microsoft.Data.SqlClient.WriteCommandBefore", new { OperationId = operationId, Command = command });
    sqlListener.Write("Microsoft.Data.SqlClient.WriteCommandAfter", new { OperationId = operationId, Command = command });

    provider.FlushForQualification();
    var evidence = string.Join("\n", Directory.GetFiles(root, "dev5054-*.jsonl").Select(File.ReadAllText));
    foreach (var required in new[]
    {
        "DiagnosticRuntimeContext", "PermissionResolution", "WorkOrderApprovalEnrichment",
        "Canonical5052RequestStart", "Canonical5052RequestComplete", "diagnostic-correlation-001",
        "DLE_OS_SECURITY_DEV", "SecurityPermissionResolutionQuery", "DefaultCredentialsEnabled",
        "TimeoutOrCancellation", "TIMEOUT_OR_CANCELLATION"
    })
        if (!evidence.Contains(required, StringComparison.Ordinal))
            throw new InvalidOperationException("Diagnostic evidence is missing " + required + ".");

    foreach (var prohibited in new[]
    {
        "Authorization: Bearer", "PRIVATE KEY", "response-body-qualification", "Password=",
        "Data Source=", "Integrated Security=True"
    })
        if (evidence.Contains(prohibited, StringComparison.OrdinalIgnoreCase))
            throw new InvalidOperationException("Diagnostic evidence contains prohibited material " + prohibited + ".");

    Console.WriteLine("PHASE2_DIAGNOSTIC_QUALIFICATION_PASS");
}
finally
{
    if (Directory.Exists(root)) Directory.Delete(root, true);
}

internal sealed class QualificationEnvironment(string root) : IHostEnvironment
{
    public string EnvironmentName { get; set; } = Environments.Development;
    public string ApplicationName { get; set; } = "DleOs.Dev5054.DiagnosticQualification";
    public string ContentRootPath { get; set; } = root;
    public IFileProvider ContentRootFileProvider { get; set; } = new PhysicalFileProvider(root);
}
