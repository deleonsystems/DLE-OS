using System.Text.Json;
using System.Text.RegularExpressions;
using DLE_OS_Server.Options;
using Microsoft.AspNetCore.StaticFiles;
using Microsoft.Extensions.FileProviders;

namespace DLE_OS_Server.Hosting;

public static partial class FrontendApplicationExtensions
{
    private const string NoStore =
        "no-store, no-cache, must-revalidate, max-age=0";
    private const string Immutable =
        "public, max-age=31536000, immutable";

    public static WebApplication UseDleOsFrontend(
        this WebApplication app,
        FrontendOptions options)
    {
        foreach (var directory in FrontendOptions.RuntimeDataDirectories)
        {
            var provider = new PhysicalFileProvider(
                Path.Combine(options.RootPath, directory));
            app.Lifetime.ApplicationStopped.Register(provider.Dispose);
            app.UseStaticFiles(new StaticFileOptions
            {
                FileProvider = provider,
                RequestPath = $"/{directory}",
                OnPrepareResponse = context =>
                {
                    context.Context.Response.Headers.CacheControl = NoStore;
                }
            });
        }

        var contentTypes = new FileExtensionContentTypeProvider();

        FrontendRelease ReadCurrentRelease()
        {
            var pointerPath = Path.Combine(
                options.PublicationRoot,
                "current-release.json");
            var release = JsonSerializer.Deserialize<FrontendRelease>(
                File.ReadAllText(pointerPath),
                new JsonSerializerOptions
                {
                    PropertyNameCaseInsensitive = true
                }) ?? throw new InvalidOperationException(
                    "Frontend current release is invalid.");

            if (!BuildIdPattern().IsMatch(release.BuildId))
            {
                throw new InvalidOperationException(
                    "Frontend current release build ID is invalid.");
            }

            var buildRoot = Path.Combine(
                options.PublicationRoot,
                "Builds",
                release.BuildId);
            if (!File.Exists(Path.Combine(buildRoot, "index.html")) ||
                !File.Exists(Path.Combine(buildRoot, "asset-manifest.json")))
            {
                throw new InvalidOperationException(
                    "Frontend current release is incomplete.");
            }

            return release;
        }

        static void SetNoStore(HttpResponse response)
        {
            response.Headers.CacheControl = NoStore;
            response.Headers.Pragma = "no-cache";
            response.Headers.Expires = "0";
        }

        IResult ServeShell(HttpContext context)
        {
            var release = ReadCurrentRelease();
            SetNoStore(context.Response);
            return Results.File(
                Path.Combine(
                    options.PublicationRoot,
                    "Builds",
                    release.BuildId,
                    "index.html"),
                "text/html");
        }

        IResult ServeCurrentBuild(HttpContext context)
        {
            var release = ReadCurrentRelease();
            SetNoStore(context.Response);
            return Results.Json(new
            {
                frontendBuildId = release.BuildId,
                publishedAtUtc = release.PublishedAtUtc,
                manifestSha256 = release.ManifestSha256
            });
        }

        IResult ServeVersionedAsset(
            HttpContext context,
            string buildId,
            string assetPath)
        {
            if (!BuildIdPattern().IsMatch(buildId) ||
                string.IsNullOrWhiteSpace(assetPath))
            {
                return Results.NotFound();
            }

            var buildRoot = Path.GetFullPath(Path.Combine(
                options.PublicationRoot,
                "Builds",
                buildId));
            var candidate = Path.GetFullPath(Path.Combine(
                buildRoot,
                assetPath.Replace('/', Path.DirectorySeparatorChar)));
            if (!candidate.StartsWith(
                    buildRoot + Path.DirectorySeparatorChar,
                    StringComparison.OrdinalIgnoreCase) ||
                !File.Exists(candidate))
            {
                return Results.NotFound();
            }

            context.Response.Headers.CacheControl = Immutable;
            contentTypes.TryGetContentType(candidate, out var contentType);
            return Results.File(
                candidate,
                contentType ?? "application/octet-stream");
        }

        app.MapGet("/", ServeShell);
        app.MapGet(
            "/api/frontend/v1/build",
            ServeCurrentBuild);
        app.MapGet(
            "/assets/{buildId}/{**assetPath}",
            ServeVersionedAsset);
        app.MapGet(
            "/app",
            () => Results.Redirect("/", permanent: true, preserveMethod: true));
        app.MapGet(
            $"/{options.EntryFile}",
            () => Results.Redirect("/", permanent: true, preserveMethod: true));

        return app;
    }

    [GeneratedRegex(
        "^[0-9]{8}T[0-9]{6}Z-[0-9A-F]{12}$",
        RegexOptions.CultureInvariant)]
    private static partial Regex BuildIdPattern();

    private sealed class FrontendRelease
    {
        public string BuildId { get; init; } = string.Empty;
        public DateTimeOffset PublishedAtUtc { get; init; }
        public string ManifestSha256 { get; init; } = string.Empty;
    }
}
