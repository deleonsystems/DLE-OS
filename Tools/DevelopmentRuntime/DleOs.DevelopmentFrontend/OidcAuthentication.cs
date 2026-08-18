using System.Security.Cryptography;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Logging;

public static class DleOsOidcSchemes
{
    public const string Cookie = "DLE-OS-OIDC-SESSION";
    public const string OpenIdConnect = "DLE-OS-KEYCLOAK";
    public const string Challenge = "DLE-OS-CHALLENGE";
}

public static class OidcChallengeBehavior
{
    public static bool IsBrowserFetch(HttpRequest request) =>
        request.Headers.TryGetValue("Sec-Fetch-Mode", out var modes) &&
        modes.Any(mode => !string.Equals(mode, "navigate", StringComparison.OrdinalIgnoreCase));

    public static bool RequiresStatusCode(HttpRequest request)
    {
        if (request.Path.StartsWithSegments("/api")) return true;
        if (IsBrowserFetch(request)) return true;
        return request.GetTypedHeaders().Accept?.Any(mediaType =>
            mediaType.MediaType.Value?.Equals("application/json", StringComparison.OrdinalIgnoreCase) == true) == true;
    }
}

public sealed class ServerSideOidcTicketStore : ITicketStore
{
    private const string TicketExtension = ".ticket";
    private readonly string storageRoot;
    private readonly IDataProtector protector;
    private readonly ILogger<ServerSideOidcTicketStore> logger;
    private readonly SemaphoreSlim gate = new(1, 1);

    public ServerSideOidcTicketStore(
        string storageRoot,
        IDataProtectionProvider dataProtectionProvider,
        ILogger<ServerSideOidcTicketStore> logger)
    {
        this.storageRoot = Path.GetFullPath(storageRoot);
        protector = dataProtectionProvider.CreateProtector(
            "DLE-OS", "Development", "OIDC-Server-Ticket", "v1");
        this.logger = logger;
        Directory.CreateDirectory(this.storageRoot);
    }

    public async Task<string> StoreAsync(AuthenticationTicket ticket)
    {
        var key = Convert.ToHexString(RandomNumberGenerator.GetBytes(32));
        await WriteAsync(key, ticket);
        return key;
    }

    public Task RenewAsync(string key, AuthenticationTicket ticket) => WriteAsync(key, ticket);

    public async Task<AuthenticationTicket?> RetrieveAsync(string key)
    {
        var path = TicketPath(key);
        await gate.WaitAsync();
        byte[]? protectedBytes = null;
        byte[]? serialized = null;
        try
        {
            if (!File.Exists(path)) return null;
            protectedBytes = await File.ReadAllBytesAsync(path);
            serialized = protector.Unprotect(protectedBytes);
            var ticket = TicketSerializer.Default.Deserialize(serialized);
            if (ticket is null ||
                ticket.Properties.ExpiresUtc is { } expires && expires <= DateTimeOffset.UtcNow)
            {
                DeleteIfPresent(path);
                return null;
            }
            return ticket;
        }
        catch (Exception exception) when (
            exception is CryptographicException or IOException or UnauthorizedAccessException or FormatException)
        {
            DeleteIfPresent(path);
            logger.LogWarning("A protected DEV authentication ticket was invalid and has been revoked.");
            return null;
        }
        finally
        {
            if (serialized is not null) Array.Clear(serialized);
            if (protectedBytes is not null) Array.Clear(protectedBytes);
            gate.Release();
        }
    }

    public async Task RemoveAsync(string key)
    {
        var path = TicketPath(key);
        await gate.WaitAsync();
        try { DeleteIfPresent(path); }
        finally { gate.Release(); }
    }

    private async Task WriteAsync(string key, AuthenticationTicket ticket)
    {
        var path = TicketPath(key);
        var temporaryPath = path + "." + Guid.NewGuid().ToString("N") + ".tmp";
        byte[]? serialized = null;
        byte[]? protectedBytes = null;
        await gate.WaitAsync();
        try
        {
            serialized = TicketSerializer.Default.Serialize(ticket);
            protectedBytes = protector.Protect(serialized);
            await File.WriteAllBytesAsync(temporaryPath, protectedBytes);
            File.Move(temporaryPath, path, overwrite: true);
        }
        finally
        {
            DeleteIfPresent(temporaryPath);
            if (serialized is not null) Array.Clear(serialized);
            if (protectedBytes is not null) Array.Clear(protectedBytes);
            gate.Release();
        }
    }

    private string TicketPath(string key)
    {
        if (key.Length != 64 || key.Any(character => !Uri.IsHexDigit(character)))
            throw new ArgumentException("The authentication ticket key is invalid.", nameof(key));
        return Path.Combine(storageRoot, key + TicketExtension);
    }

    private static void DeleteIfPresent(string path)
    {
        try { File.Delete(path); }
        catch (FileNotFoundException) { }
    }
}
