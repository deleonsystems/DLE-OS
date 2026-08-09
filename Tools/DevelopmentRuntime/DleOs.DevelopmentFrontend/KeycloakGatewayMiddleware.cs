using System.Net;
using System.Net.Http.Headers;

public sealed class KeycloakGatewayMiddleware(
    RequestDelegate next,
    IHttpClientFactory httpClientFactory,
    ILogger<KeycloakGatewayMiddleware> logger)
{
    public const string PublicHostname = "auth.internal.dlemfg.com";
    private static readonly Uri Backend = new("http://127.0.0.1:8180");
    private static readonly HashSet<string> HopByHopHeaders = new(StringComparer.OrdinalIgnoreCase)
    {
        "Connection", "Keep-Alive", "Proxy-Authenticate", "Proxy-Authorization", "TE",
        "Trailer", "Transfer-Encoding", "Upgrade"
    };

    public async Task InvokeAsync(HttpContext context)
    {
        if (!context.Request.Host.Host.Equals(PublicHostname, StringComparison.OrdinalIgnoreCase))
        {
            await next(context);
            return;
        }

        var target = new UriBuilder(Backend)
        {
            Path = context.Request.Path,
            Query = context.Request.QueryString.HasValue ? context.Request.QueryString.Value![1..] : ""
        }.Uri;
        using var request = new HttpRequestMessage(new HttpMethod(context.Request.Method), target);
        if (context.Request.ContentLength > 0 || context.Request.Headers.ContainsKey("Transfer-Encoding"))
            request.Content = new StreamContent(context.Request.Body);

        foreach (var header in context.Request.Headers)
        {
            if (HopByHopHeaders.Contains(header.Key) ||
                header.Key.Equals("Host", StringComparison.OrdinalIgnoreCase) ||
                header.Key.StartsWith("X-Forwarded-", StringComparison.OrdinalIgnoreCase))
                continue;
            if (!request.Headers.TryAddWithoutValidation(header.Key, header.Value.ToArray()))
                request.Content?.Headers.TryAddWithoutValidation(header.Key, header.Value.ToArray());
        }
        request.Headers.Host = PublicHostname;
        request.Headers.TryAddWithoutValidation("X-Forwarded-Proto", "https");
        request.Headers.TryAddWithoutValidation("X-Forwarded-Host", PublicHostname);
        request.Headers.TryAddWithoutValidation("X-Forwarded-Port", "443");
        if (context.Connection.RemoteIpAddress is { } remoteAddress)
            request.Headers.TryAddWithoutValidation("X-Forwarded-For", remoteAddress.ToString());

        try
        {
            using var response = await httpClientFactory.CreateClient("KeycloakLoopback")
                .SendAsync(request, HttpCompletionOption.ResponseHeadersRead, context.RequestAborted);
            context.Response.StatusCode = (int)response.StatusCode;
            foreach (var header in response.Headers)
                if (!HopByHopHeaders.Contains(header.Key))
                    context.Response.Headers[header.Key] = header.Value.ToArray();
            foreach (var header in response.Content.Headers)
                if (!HopByHopHeaders.Contains(header.Key))
                    context.Response.Headers[header.Key] = header.Value.ToArray();
            context.Response.Headers.Remove("transfer-encoding");
            await response.Content.CopyToAsync(context.Response.Body, context.RequestAborted);
        }
        catch (HttpRequestException exception)
        {
            logger.LogError(exception, "Keycloak loopback gateway failed for {Path}", context.Request.Path);
            if (!context.Response.HasStarted)
                context.Response.StatusCode = StatusCodes.Status503ServiceUnavailable;
        }
    }
}
