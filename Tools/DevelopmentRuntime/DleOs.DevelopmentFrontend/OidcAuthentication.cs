using System.Collections.Concurrent;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;

public static class DleOsOidcSchemes
{
    public const string Cookie = "DLE-OS-OIDC-SESSION";
    public const string OpenIdConnect = "DLE-OS-KEYCLOAK";
}

public sealed class ServerSideOidcTicketStore : ITicketStore
{
    private readonly ConcurrentDictionary<string, AuthenticationTicket> tickets =
        new(StringComparer.Ordinal);

    public Task<string> StoreAsync(AuthenticationTicket ticket)
    {
        var key = Convert.ToHexString(System.Security.Cryptography.RandomNumberGenerator.GetBytes(32));
        tickets[key] = ticket;
        return Task.FromResult(key);
    }

    public Task RenewAsync(string key, AuthenticationTicket ticket)
    {
        tickets[key] = ticket;
        return Task.CompletedTask;
    }

    public Task<AuthenticationTicket?> RetrieveAsync(string key)
    {
        if (!tickets.TryGetValue(key, out var ticket))
            return Task.FromResult<AuthenticationTicket?>(null);
        if (ticket.Properties.ExpiresUtc is { } expires && expires <= DateTimeOffset.UtcNow)
        {
            tickets.TryRemove(key, out _);
            return Task.FromResult<AuthenticationTicket?>(null);
        }
        return Task.FromResult<AuthenticationTicket?>(ticket);
    }

    public Task RemoveAsync(string key)
    {
        tickets.TryRemove(key, out _);
        return Task.CompletedTask;
    }
}
