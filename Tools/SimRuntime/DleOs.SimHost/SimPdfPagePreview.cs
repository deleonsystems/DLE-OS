using System.Diagnostics;

internal static class SimPdfPagePreview
{
    private static readonly SemaphoreSlim Slots = new(2);
    internal static async Task<byte[]> Render(byte[] bytes, int page)
    {
        if (page is < 1 or > 200 || bytes.Length > 20 * 1024 * 1024) throw new IOException("Page unavailable.");
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(10));
        using var process = new Process();
        var acquired = false;
        try
        {
            await Slots.WaitAsync(timeout.Token); acquired = true;
            var python = Environment.GetEnvironmentVariable("DLE_OS_SIM_BOM_PYTHON") ?? Path.Combine(
                Environment.GetEnvironmentVariable("USERPROFILE") ?? Environment.GetFolderPath(Environment.SpecialFolder.UserProfile),
                ".cache", "codex-runtimes", "codex-primary-runtime", "dependencies", "python", "python.exe");
            process.StartInfo = new(python) { UseShellExecute = false, CreateNoWindow = true,
                RedirectStandardInput = true, RedirectStandardOutput = true, RedirectStandardError = true };
            process.StartInfo.ArgumentList.Add("-I");
            process.StartInfo.ArgumentList.Add(Path.Combine(AppContext.BaseDirectory, "sim_pdf_page_preview.py"));
            process.StartInfo.ArgumentList.Add(page.ToString(System.Globalization.CultureInfo.InvariantCulture));
            process.Start();
            using var output = new MemoryStream();
            var copy = process.StandardOutput.BaseStream.CopyToAsync(output, timeout.Token);
            var errors = process.StandardError.ReadToEndAsync(timeout.Token);
            await process.StandardInput.BaseStream.WriteAsync(bytes, timeout.Token); process.StandardInput.Close();
            await process.WaitForExitAsync(timeout.Token); await copy; await errors;
            if (process.ExitCode != 0 || output.Length == 0) throw new IOException("Page unavailable.");
            return output.ToArray();
        }
        catch (Exception e) when (e is OperationCanceledException or InvalidOperationException or System.ComponentModel.Win32Exception)
        { throw new IOException("Local page preview is unavailable.", e); }
        finally
        {
            try { if (process.Id > 0 && !process.HasExited) process.Kill(entireProcessTree: true); }
            catch (Exception e) when (e is InvalidOperationException or System.ComponentModel.Win32Exception) { }
            if (acquired) Slots.Release();
        }
    }
}
