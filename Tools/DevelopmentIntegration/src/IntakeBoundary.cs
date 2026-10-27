namespace DleOs.Integration;

// Resolved from an authenticated server identity. No fixture or header fallback.
public sealed record Actor(Guid UserId, IReadOnlySet<string> Permissions, string DisplayName = "");
public interface IActorResolver { ValueTask<Actor?> Resolve(HttpContext context); }
public interface IRequestIntegrity { ValueTask<bool> Validate(HttpContext context); }
public sealed class BoundaryProblem(int status, string code) : Exception(code)
{ public int Status { get; } = status; public string Code { get; } = code; }

public static class QuotingLimits
{
    public const long FileLimit = 5 * 1024 * 1024;
    public const long JsonLimit = 2 * 1024 * 1024;
}
