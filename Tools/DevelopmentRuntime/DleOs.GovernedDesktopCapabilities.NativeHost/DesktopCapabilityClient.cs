using System.Net.Http.Json;
using System.Text.Json;

internal sealed class DesktopCapabilityClient : IDisposable
{
    internal static readonly Uri RedemptionEndpoint = new(
        "http://dle-os-host:5051/api/development/desktop-capabilities/v1/redeem");

    private readonly HttpClient client;

    internal DesktopCapabilityClient()
    {
        client = new HttpClient(new SocketsHttpHandler
        {
            UseProxy = false,
            AllowAutoRedirect = false
        })
        {
            Timeout = TimeSpan.FromSeconds(8)
        };
    }

    internal async Task<NativeCapabilityRedemption> RedeemAsync(
        NativeHostRequest request,
        CancellationToken cancellationToken)
    {
        using var response = await client.PostAsJsonAsync(RedemptionEndpoint, new
        {
            version = request.Version,
            operation = request.Operation,
            capability = request.Capability,
            correlationId = request.CorrelationId
        }, cancellationToken);
        if (!response.IsSuccessStatusCode)
            throw new DesktopCapabilityException("CapabilityRejected");

        NativeCapabilityRedemption? redemption;
        try
        {
            redemption = await response.Content.ReadFromJsonAsync<NativeCapabilityRedemption>(
                cancellationToken: cancellationToken);
        }
        catch (JsonException)
        {
            throw new DesktopCapabilityException("InvalidRedemption");
        }
        if (redemption is null || redemption.Version != NativeHostContract.Version ||
            !string.Equals(redemption.Operation, NativeHostContract.Operation, StringComparison.Ordinal) ||
            !string.Equals(redemption.CorrelationId, request.CorrelationId, StringComparison.Ordinal) ||
            redemption.ExpiresAtUtc <= DateTimeOffset.UtcNow)
            throw new DesktopCapabilityException("InvalidRedemption");
        return redemption;
    }

    public void Dispose() => client.Dispose();
}

internal sealed record NativeCapabilityRedemption(
    int Version,
    string Operation,
    string RelativePath,
    DateTimeOffset ExpiresAtUtc,
    string CorrelationId);

internal sealed class DesktopCapabilityException(string category) : Exception
{
    internal string Category { get; } = category;
}
