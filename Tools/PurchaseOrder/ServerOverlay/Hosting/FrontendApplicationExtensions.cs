using DLE_OS_Server.Options;
using Microsoft.Extensions.FileProviders;

namespace DLE_OS_Server.Hosting;

public static class FrontendApplicationExtensions
{
    public static WebApplication UseDleOsFrontend(
        this WebApplication app,
        FrontendOptions options)
    {
        foreach (var directory in FrontendOptions.RuntimeDirectories)
        {
            var provider = new PhysicalFileProvider(
                Path.Combine(options.RootPath, directory));

            app.Lifetime.ApplicationStopped.Register(provider.Dispose);

            app.UseStaticFiles(new StaticFileOptions
            {
                FileProvider = provider,
                RequestPath = $"/{directory}"
            });
        }

        var entryFilePath = Path.Combine(
            options.RootPath,
            options.EntryFile);

        IResult ServeEntryFile(HttpContext context)
        {
            context.Response.Headers.CacheControl =
                "no-store, no-cache, must-revalidate, max-age=0";
            context.Response.Headers.Pragma = "no-cache";
            context.Response.Headers.Expires = "0";
            return Results.File(entryFilePath, "text/html");
        }

        app.MapGet("/", ServeEntryFile);
        app.MapGet("/app", ServeEntryFile);
        app.MapGet($"/{options.EntryFile}", ServeEntryFile);

        return app;
    }
}
