using System.Diagnostics;
using System.Text.Json;
using System.Text.Json.Nodes;

// All Codex wire messages are confined to this adapter. No Codex types enter DLE contracts.
internal sealed class CodexAppServerAnalysisProvider(string stateRoot, Action<string>? diagnostic = null) : IAnalysisProvider
{
    public async Task<DleAnalysisResponse> ExecuteAnalysisJob(DleAnalysisInput input, DleAnalysisDocument[] documents,
        string instructions, CancellationToken cancellationToken)
    {
        var executable = Environment.GetEnvironmentVariable("DLE_OS_SIM_CODEX_EXECUTABLE");
        if (string.IsNullOrWhiteSpace(executable) || !Path.IsPathFullyQualified(executable) || !File.Exists(executable))
            throw new IOException("Provider unavailable");
        var work = Path.GetFullPath(Path.Combine(stateRoot, "analysis-work", input.JobId));
        SimRuntimeOptions.EnsureDescendant(stateRoot, work);
        if (!Guid.TryParseExact(input.JobId, "D", out _)) throw new IOException("Invalid job identity");
        foreach (var path in new[] { stateRoot, Path.GetDirectoryName(work)!, work })
            if (Directory.Exists(path) && File.GetAttributes(path).HasFlag(FileAttributes.ReparsePoint)) throw new IOException("Unsafe work boundary");
        Directory.CreateDirectory(work);
        Process? server = null;
        try
        {
            var inputs = new List<object> { new { type = "text", text = instructions + "\nDLE job:\n" + JsonSerializer.Serialize(input, DleAnalysisContract.Json) } };
            var unavailable = new HashSet<string>();
            foreach (var document in documents)
            {
                var page = document.Source.DocumentId == input.GoverningDocumentId ? input.GoverningPage : 1;
                try
                {
                    if (document.Source.MimeType != "application/pdf") throw new IOException("Unsupported representation");
                    var rendered = await Render(document.Bytes, page, cancellationToken);
                    inputs.Add(new { type = "text", text = $"Document {document.Source.DocumentId}, role {document.Source.Role}, page {page}. Verified representation:\n{rendered.GetProperty("text").GetString()}" });
                    inputs.Add(new { type = "image", url = "data:image/png;base64," + rendered.GetProperty("image").GetString() });
                }
                catch (Exception e) when (e is IOException or JsonException)
                {
                    if (document.Source.DocumentId == input.GoverningDocumentId) throw new IOException("Governing representation unavailable");
                    unavailable.Add(document.Source.DocumentId);
                    inputs.Add(new { type = "text", text = $"Supporting document {document.Source.DocumentId} unavailable. Use NOT_COMPARED; no supporting evidence may be invented." });
                }
            }
            diagnostic?.Invoke("Approved document representations prepared");
            var start = StartInfo(executable);
            start.WorkingDirectory = work;
            start.ArgumentList.Add("app-server"); start.ArgumentList.Add("--listen"); start.ArgumentList.Add("stdio://");
            server = Process.Start(start) ?? throw new IOException("Provider unavailable");
            // Drain without exposing agent output or credentials in host logs.
            var errors = Drain(server.StandardError, cancellationToken);
            async Task Send(object message) => await server.StandardInput.WriteLineAsync(JsonSerializer.Serialize(message).AsMemory(), cancellationToken);
            async Task<JsonElement> Read()
            {
                var line = await server.StandardOutput.ReadLineAsync(cancellationToken) ?? throw new IOException("Provider closed transport");
                if (line.Length > 2_000_000) throw new IOException("Provider output too large");
                using var parsed = JsonDocument.Parse(line);
                var message = parsed.RootElement.Clone();
                if (message.TryGetProperty("method", out _) && message.TryGetProperty("id", out var requestId))
                {
                    // No approvals, tool execution, account changes or input requests are delegated to the user.
                    await Send(new { id = requestId, error = new { code = -32601, message = "Interactive requests are disabled for DLE analysis." } });
                    throw new IOException("Unexpected interactive provider request");
                }
                return message;
            }
            async Task<JsonElement> Call(int id, string method, object parameters)
            {
                await Send(new { id, method, @params = parameters });
                while (true)
                {
                    var message = await Read();
                    if (!message.TryGetProperty("id", out var replyId) || replyId.GetInt32() != id) continue;
                    if (message.TryGetProperty("error", out _)) throw new IOException("Provider protocol rejected request");
                    return message.GetProperty("result");
                }
            }
            var initialized = await Call(1, "initialize", new { clientInfo = new { name = "dle-sim-analysis", version = "1" }, capabilities = new { experimentalApi = true } });
            var version = initialized.GetProperty("userAgent").GetString() ?? "unknown";
            diagnostic?.Invoke("App Server initialized");
            await Send(new { method = "initialized" });
            var account = await Call(2, "account/read", new { refreshToken = false });
            if (account.GetProperty("account").ValueKind == JsonValueKind.Null) throw new IOException("Provider authentication unavailable");
            diagnostic?.Invoke("Provider account available");
            var config = new Dictionary<string, object> {
                ["default_permissions"] = "dle-analysis", ["permissions.dle-analysis.filesystem"] = new Dictionary<string, object> {
                    [":root"] = "deny", [":minimal"] = "read", [":workspace_roots"] = new Dictionary<string, string> { ["."] = "read" } },
                ["permissions.dle-analysis.network.enabled"] = false, ["web_search"] = "disabled",
                ["shell_environment_policy.inherit"] = "none", ["project_doc_max_bytes"] = 0
            };
            foreach (var feature in new[] { "shell_tool", "unified_exec", "plugins", "apps", "browser_use", "computer_use", "view_image", "workspace_dependencies", "shell_snapshot", "multi_agent", "skill_search", "skill_mcp_dependency_install" })
                config["features." + feature] = false;
            var configured = await Call(3, "config/read", new { includeLayers = false });
            diagnostic?.Invoke("Provider configuration read");
            if (configured.GetProperty("config").TryGetProperty("mcp_servers", out var mcp) && mcp.ValueKind == JsonValueKind.Object)
                foreach (var entry in mcp.EnumerateObject()) config["mcp_servers." + entry.Name + ".enabled"] = false;
            var thread = await Call(4, "thread/start", new { cwd = work, ephemeral = true, approvalPolicy = "never", config,
                baseInstructions = "You analyze supplied business document representations. Use no tools. Return only the requested structured result." });
            if (!thread.TryGetProperty("activePermissionProfile", out var permission) || permission.GetProperty("id").GetString() != "dle-analysis")
                throw new IOException("Provider isolation unavailable");
            var threadId = thread.GetProperty("thread").GetProperty("id").GetString();
            var model = thread.GetProperty("model").GetString() ?? "unknown";
            diagnostic?.Invoke("Isolated session started");
            await Call(5, "turn/start", new { threadId, input = inputs, effort = "low", outputSchema = Schema() });
            diagnostic?.Invoke("Analysis turn started");
            string? final = null;
            while (true)
            {
                var message = await Read();
                if (!message.TryGetProperty("method", out var method)) continue;
                if (method.GetString() == "item/completed")
                {
                    var item = message.GetProperty("params").GetProperty("item");
                    if (item.GetProperty("type").GetString() == "agentMessage") final = item.GetProperty("text").GetString();
                }
                if (method.GetString() != "turn/completed") continue;
                if (message.GetProperty("params").GetProperty("turn").GetProperty("status").GetString() != "completed" || final is null || final.Length > 500_000)
                    throw new IOException("Provider failed");
                var result = JsonSerializer.Deserialize<DleAnalysisResult>(final, DleAnalysisContract.Json) ?? throw new IOException("Malformed result");
                if (result.Rows?.Any(r => r.Fields?.Values.Any(f => f?.SupportingEvidence is not null && unavailable.Contains(f.SupportingEvidence.DocumentId)) == true) == true)
                    throw new InvalidDataException("Evidence cites an unavailable supporting representation");
                return new(result, "CODEX_APP_SERVER", version, model);
            }
        }
        finally
        {
            if (server is not null) { if (!server.HasExited) server.Kill(true); server.Dispose(); }
            // No source binaries were copied here. Delete only the exact empty job workspace.
            if (Directory.Exists(work) && !Directory.EnumerateFileSystemEntries(work).Any()) Directory.Delete(work);
        }
    }
    private static ProcessStartInfo StartInfo(string executable)
    {
        var info = new ProcessStartInfo(executable) { UseShellExecute = false, CreateNoWindow = true,
            RedirectStandardInput = true, RedirectStandardOutput = true, RedirectStandardError = true };
        var allowed = new HashSet<string>(["SYSTEMROOT", "WINDIR", "USERPROFILE", "LOCALAPPDATA", "APPDATA", "TEMP", "TMP", "PATH", "PATHEXT"], StringComparer.OrdinalIgnoreCase);
        foreach (var name in info.Environment.Keys.ToArray()) if (!allowed.Contains(name)) info.Environment.Remove(name);
        return info;
    }
    private static async Task Drain(StreamReader reader, CancellationToken ct)
    {
        var buffer = new char[4096];
        try { while (await reader.ReadAsync(buffer.AsMemory(), ct) != 0) { } } catch (OperationCanceledException) { }
    }
    private static async Task<JsonElement> Render(byte[] bytes, int page, CancellationToken ct)
    {
        var python = Environment.GetEnvironmentVariable("DLE_OS_SIM_BOM_PYTHON") ?? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile),
            ".cache", "codex-runtimes", "codex-primary-runtime", "dependencies", "python", "python.exe");
        var start = StartInfo(python);
        start.ArgumentList.Add("-I"); start.ArgumentList.Add(Path.Combine(AppContext.BaseDirectory, "Analysis", "render-document.py"));
        start.ArgumentList.Add(page.ToString(System.Globalization.CultureInfo.InvariantCulture));
        using var process = Process.Start(start) ?? throw new IOException("Renderer unavailable");
        try
        {
            var output = process.StandardOutput.ReadToEndAsync(ct); var errors = Drain(process.StandardError, ct);
            await process.StandardInput.BaseStream.WriteAsync(bytes, ct); process.StandardInput.Close();
            await process.WaitForExitAsync(ct); await errors;
            var text = await output;
            if (process.ExitCode != 0 || text.Length > 8_000_000) throw new IOException("Renderer failed");
            using var json = JsonDocument.Parse(text); return json.RootElement.Clone();
        }
        finally { if (!process.HasExited) process.Kill(true); }
    }
    internal static JsonObject Schema()
    {
        static JsonObject Text(bool nullable = false) => new() { ["type"] = nullable ? new JsonArray("string", "null") : JsonValue.Create("string") };
        static JsonObject Obj(Dictionary<string, JsonNode?> properties) => new() { ["type"] = "object", ["additionalProperties"] = false,
            ["properties"] = new JsonObject(properties), ["required"] = new JsonArray(properties.Keys.Select(k => (JsonNode?)JsonValue.Create(k)).ToArray()) };
        JsonObject Evidence() => Obj(new() { ["documentId"] = Text(), ["page"] = new JsonObject { ["type"] = new JsonArray("integer", "null") }, ["sheet"] = Text(true), ["location"] = Text() });
        JsonObject Field() => Obj(new() { ["value"] = Text(true), ["evidence"] = Evidence(), ["uncertainty"] = Text(),
            ["relationship"] = new JsonObject { ["type"] = "string", ["enum"] = new JsonArray("MATCH", "CONFLICT", "NOT_FOUND", "NOT_COMPARED") },
            ["supportingValue"] = Text(true), ["supportingEvidence"] = new JsonObject { ["anyOf"] = new JsonArray(Evidence(), new JsonObject { ["type"] = "null" }) } });
        return Obj(new() { ["contractVersion"] = new JsonObject { ["type"] = "string", ["enum"] = new JsonArray(DleAnalysisContract.ResultVersion) },
            ["outcome"] = new JsonObject { ["type"] = "string", ["enum"] = new JsonArray("EXTRACTED", "BLOCKED") },
            ["coverage"] = new JsonObject { ["type"] = "string", ["enum"] = new JsonArray("PARTIAL") }, ["coverageReason"] = Text(),
            ["rows"] = new JsonObject { ["type"] = "array", ["items"] = Obj(new() { ["fields"] = Obj(SimCandidateBomProvider.Fields.ToDictionary(f => f, _ => (JsonNode?)Field())) }) } });
    }
}
