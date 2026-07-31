using Microsoft.AspNetCore.StaticFiles;
using Microsoft.Extensions.FileProviders;

var builder = WebApplication.CreateBuilder(args);
var app = builder.Build();
const string repository = @"C:\DLE-OS\Repositories\DLE-OS";
var provider = new PhysicalFileProvider(repository);
var contentTypes = new FileExtensionContentTypeProvider();
app.Lifetime.ApplicationStopped.Register(provider.Dispose);

void NoStore(HttpResponse response)
{
    response.Headers.CacheControl = "no-store, no-cache, must-revalidate, max-age=0";
    response.Headers.Pragma = "no-cache";
    response.Headers.Expires = "0";
}

app.MapGet("/", (HttpContext context) =>
{
    NoStore(context.Response);
    return Results.File(
        Path.Combine(repository, "DLE_Work_Center_v4.0.0.html"),
        "text/html");
});
app.UseStaticFiles(new StaticFileOptions
{
    FileProvider = provider,
    OnPrepareResponse = context => NoStore(context.Context.Response)
});
app.Run();
