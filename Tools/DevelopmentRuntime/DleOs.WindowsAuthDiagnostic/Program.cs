using System.Security.Principal;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.Server.HttpSys;

const string diagnosticPrefix = "http://dle-os-host:5055";

if (!OperatingSystem.IsWindows())
    throw new PlatformNotSupportedException(
        "The Windows-authentication diagnostic requires Windows.");
if (!string.Equals(
    Environment.MachineName,
    "DLE-OS-HOST",
    StringComparison.OrdinalIgnoreCase))
    throw new InvalidOperationException(
        "The Windows-authentication diagnostic may run only on DLE-OS-HOST.");

var builder = WebApplication.CreateBuilder(args);
builder.Logging.ClearProviders();
builder.Logging.AddConsole();
builder.WebHost.UseHttpSys(options =>
{
    options.UrlPrefixes.Add(diagnosticPrefix);
    options.Authentication.Schemes =
        AuthenticationSchemes.Negotiate | AuthenticationSchemes.NTLM;
    options.Authentication.AllowAnonymous = false;
});
builder.Services.AddAuthentication(HttpSysDefaults.AuthenticationScheme);
builder.Services.AddAuthorization();
builder.Services.AddDataProtection().UseEphemeralDataProtectionProvider();

var app = builder.Build();
app.UseAuthentication();
app.UseAuthorization();

app.MapGet(
        "/api/auth/whoami",
        (HttpContext context, ILoggerFactory loggerFactory) =>
        {
            var identity = context.User.Identity;
            loggerFactory
                .CreateLogger("Phase1C.WindowsAuthDiagnostic")
                .LogInformation(
                    "Proof={Proof}; IsAuthenticated={IsAuthenticated}; " +
                    "AuthenticationType={AuthenticationType}; " +
                    "CallerIdentity={CallerIdentity}; UserAgent={UserAgent}",
                    context.Request.Query["proof"].ToString(),
                    identity?.IsAuthenticated ?? false,
                    identity?.AuthenticationType,
                    identity?.Name,
                    context.Request.Headers.UserAgent.ToString());
            return Results.Json(new
            {
                isAuthenticated = identity?.IsAuthenticated ?? false,
                authenticationType = identity?.AuthenticationType,
                callerIdentity = identity?.Name,
                executionIdentity = WindowsIdentity.GetCurrent().Name
            });
        })
    .RequireAuthorization();

app.Run();
