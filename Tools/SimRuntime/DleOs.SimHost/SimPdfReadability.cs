using System.Diagnostics;
using System.Text.Json;

internal sealed record SimPdfReadabilityResult(string Status, int? PageCount = null,
    int? TextPageCount = null, int? ImageOnlyPageCount = null, string? Reason = null);

internal static class SimPdfReadability
{
    internal static readonly SimPdfReadabilityResult Unknown = new("UNKNOWN", Reason: "CHECK_UNAVAILABLE");
    private static readonly SemaphoreSlim Slots = new(2);

    internal static async Task<SimPdfReadabilityResult> Inspect(byte[] bytes)
    {
        if (!bytes.AsSpan().StartsWith("%PDF-"u8) || bytes.Length > 20 * 1024 * 1024) return Unknown;
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(8));
        var acquired = false;
        using var process = new Process();
        try
        {
            await Slots.WaitAsync(timeout.Token);
            acquired = true;
            var python = Environment.GetEnvironmentVariable("DLE_OS_SIM_BOM_PYTHON") ?? Path.Combine(
                Environment.GetEnvironmentVariable("USERPROFILE") ?? Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), ".cache", "codex-runtimes",
                "codex-primary-runtime", "dependencies", "python", "python.exe");
            process.StartInfo = new(python) { UseShellExecute = false, CreateNoWindow = true,
                RedirectStandardInput = true, RedirectStandardOutput = true, RedirectStandardError = true };
            process.StartInfo.ArgumentList.Add("-I");
            process.StartInfo.ArgumentList.Add(Path.Combine(AppContext.BaseDirectory, "sim_pdf_readability.py"));
            process.Start();
            var output = process.StandardOutput.ReadToEndAsync(timeout.Token);
            var errors = process.StandardError.ReadToEndAsync(timeout.Token);
            await process.StandardInput.BaseStream.WriteAsync(bytes, timeout.Token);
            process.StandardInput.Close();
            await process.WaitForExitAsync(timeout.Token);
            var result = await output;
            await errors;
            if (process.ExitCode != 0) return Unknown;
            var parsed = JsonSerializer.Deserialize<SimPdfReadabilityResult>(result, new JsonSerializerOptions(JsonSerializerDefaults.Web));
            return parsed?.Status is "TEXT_READABLE" or "IMAGE_ONLY" or "MIXED" or "UNKNOWN" ? parsed : Unknown;
        }
        catch (Exception e) when (e is IOException or OperationCanceledException or InvalidOperationException or System.ComponentModel.Win32Exception or JsonException)
        { return Unknown; }
        finally
        {
            try { if (process.Id > 0 && !process.HasExited) process.Kill(entireProcessTree: true); }
            catch (Exception e) when (e is InvalidOperationException or System.ComponentModel.Win32Exception) { }
            if (acquired) Slots.Release();
        }
    }
}
