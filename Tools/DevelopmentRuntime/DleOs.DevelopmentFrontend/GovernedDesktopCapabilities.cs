using System.Collections.Concurrent;
using System.Net;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using Microsoft.AspNetCore.Http;

internal sealed partial class GovernedDesktopCapabilityBroker
{
    internal const string Operation = "open-drawing-folder";
    internal const int SchemaVersion = 1;
    internal static readonly TimeSpan Lifetime = TimeSpan.FromMinutes(2);

    private readonly ConcurrentDictionary<string, CapabilityEntry> entries = new(StringComparer.Ordinal);
    private readonly TimeProvider clock;

    internal GovernedDesktopCapabilityBroker(TimeProvider? clock = null)
    {
        this.clock = clock ?? TimeProvider.System;
    }

    internal DrawingPrintsDesktopResolution Attach(
        DrawingPrintsResolution resolution,
        string correlationId)
    {
        var cleanCorrelationId = CleanCorrelationId(correlationId);
        var open = IssueForUri(resolution.OpenUri, cleanCorrelationId);
        var deepest = IssueForUri(resolution.DeepestOpenUri, cleanCorrelationId);
        var choices = resolution.Choices.Select(choice =>
        {
            var capability = IssueForUri(choice.OpenUri, cleanCorrelationId);
            return new DrawingPrintsDesktopChoice(
                choice.Kind,
                choice.DisplayLabel,
                choice.OpenUri,
                capability?.Token);
        }).ToArray();

        return new DrawingPrintsDesktopResolution(
            resolution.Status,
            resolution.CustomerName,
            resolution.AssemblyNumber,
            resolution.Revision,
            resolution.ResolvedCustomerName,
            resolution.ResolvedAssemblyName,
            resolution.ResolvedRevisionName,
            resolution.OpenUri,
            resolution.DeepestOpenUri,
            open?.Token,
            deepest?.Token,
            cleanCorrelationId,
            choices,
            resolution.Message);
    }

    internal bool TryRedeem(
        DesktopCapabilityRedeemRequest? request,
        out DesktopCapabilityRedemption? redemption,
        out string failureCategory)
    {
        redemption = null;
        failureCategory = "InvalidRequest";
        if (request is null ||
            request.Version != SchemaVersion ||
            !string.Equals(request.Operation, Operation, StringComparison.Ordinal) ||
            !CapabilityToken().IsMatch(request.Capability ?? "") ||
            !string.Equals(CleanCorrelationId(request.CorrelationId), request.CorrelationId, StringComparison.Ordinal))
            return false;

        var token = request.Capability!;
        if (!entries.TryRemove(token, out var entry))
        {
            failureCategory = "UnknownOrReplayedCapability";
            return false;
        }

        var now = clock.GetUtcNow();
        if (entry.ExpiresAtUtc <= now)
        {
            failureCategory = "ExpiredCapability";
            return false;
        }
        if (!string.Equals(entry.CorrelationId, request.CorrelationId, StringComparison.Ordinal))
        {
            failureCategory = "CapabilityBindingMismatch";
            return false;
        }

        redemption = new DesktopCapabilityRedemption(
            SchemaVersion,
            Operation,
            entry.RelativePath,
            entry.ExpiresAtUtc,
            entry.CorrelationId);
        failureCategory = "None";
        return true;
    }

    internal static bool IsSameHostRequest(HttpContext context)
    {
        var remote = context.Connection.RemoteIpAddress;
        var local = context.Connection.LocalIpAddress;
        return remote is not null &&
            (IPAddress.IsLoopback(remote) || (local is not null && remote.Equals(local)));
    }

    private IssuedCapability? IssueForUri(string? openUri, string correlationId)
    {
        if (!TryDecodeGovernedRelativePath(openUri, out var relativePath)) return null;
        PruneExpired();
        if (entries.Count >= 2048) return null;

        Span<byte> random = stackalloc byte[32];
        RandomNumberGenerator.Fill(random);
        var token = "dlecap1_" + Convert.ToBase64String(random)
            .TrimEnd('=').Replace('+', '-').Replace('/', '_');
        var expiresAtUtc = clock.GetUtcNow().Add(Lifetime);
        return entries.TryAdd(token, new(relativePath, correlationId, expiresAtUtc))
            ? new(token)
            : null;
    }

    private void PruneExpired()
    {
        var now = clock.GetUtcNow();
        foreach (var pair in entries)
            if (pair.Value.ExpiresAtUtc <= now)
                entries.TryRemove(pair.Key, out _);
    }

    private static bool TryDecodeGovernedRelativePath(string? openUri, out string relativePath)
    {
        relativePath = "";
        var match = GovernedOpenUri().Match(openUri ?? "");
        if (!match.Success) return false;
        try
        {
            var base64 = match.Groups["token"].Value.Replace('-', '+').Replace('_', '/');
            base64 += new string('=', (4 - base64.Length % 4) % 4);
            relativePath = new UTF8Encoding(false, true).GetString(Convert.FromBase64String(base64));
        }
        catch (Exception exception) when (exception is FormatException or DecoderFallbackException)
        {
            return false;
        }
        return IsSafeRelativePath(relativePath);
    }

    private static bool IsSafeRelativePath(string value)
    {
        if (string.IsNullOrWhiteSpace(value) || value.Length > 1024 || Path.IsPathRooted(value) ||
            value.IndexOfAny(Path.GetInvalidPathChars()) >= 0)
            return false;
        var segments = value.Split(['\\', '/'], StringSplitOptions.RemoveEmptyEntries);
        return segments.Length > 0 && segments.All(segment => segment is not "." and not "..");
    }

    private static string CleanCorrelationId(string? value)
    {
        var clean = (value ?? "").Trim();
        return clean.Length is > 0 and <= 128 && clean.All(character => !char.IsControl(character))
            ? clean
            : "not-provided";
    }

    [GeneratedRegex("^dle-drawing-prints://open/(?<token>[A-Za-z0-9_-]{2,1366})$", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant)]
    private static partial Regex GovernedOpenUri();

    [GeneratedRegex("^dlecap1_[A-Za-z0-9_-]{43}$", RegexOptions.CultureInvariant)]
    private static partial Regex CapabilityToken();

    private sealed record CapabilityEntry(
        string RelativePath,
        string CorrelationId,
        DateTimeOffset ExpiresAtUtc);

    private sealed record IssuedCapability(string Token);
}

internal sealed record DrawingPrintsDesktopChoice(
    string Kind,
    string DisplayLabel,
    string OpenUri,
    string? DesktopCapability);

internal sealed record DrawingPrintsDesktopResolution(
    string Status,
    string? CustomerName,
    string? AssemblyNumber,
    string? Revision,
    string? ResolvedCustomerName,
    string? ResolvedAssemblyName,
    string? ResolvedRevisionName,
    string? OpenUri,
    string? DeepestOpenUri,
    string? DesktopCapability,
    string? DeepestDesktopCapability,
    string CapabilityCorrelationId,
    IReadOnlyList<DrawingPrintsDesktopChoice> Choices,
    string Message);

internal sealed record DesktopCapabilityRedeemRequest(
    int Version,
    string? Operation,
    string? Capability,
    string? CorrelationId);

internal sealed record DesktopCapabilityRedemption(
    int Version,
    string Operation,
    string RelativePath,
    DateTimeOffset ExpiresAtUtc,
    string CorrelationId);
