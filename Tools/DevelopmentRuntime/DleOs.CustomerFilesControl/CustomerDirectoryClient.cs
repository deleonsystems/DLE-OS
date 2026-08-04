using System.Net;
using System.Net.Http.Json;

namespace DleOs.CustomerFilesControl;

public interface ICustomerDirectory
{
    Task<CanonicalCustomer?> FindAsync(
        string customerNumber,
        CancellationToken cancellationToken);
    Task<IReadOnlyList<CanonicalCustomer>> GetAllAsync(
        CancellationToken cancellationToken);
}

public sealed class CustomerDirectoryClient : ICustomerDirectory
{
    private readonly HttpClient _httpClient;

    public CustomerDirectoryClient(HttpClient httpClient)
    {
        _httpClient = httpClient;
    }

    public async Task<CanonicalCustomer?> FindAsync(
        string customerNumber,
        CancellationToken cancellationToken)
    {
        var path =
            "/api/platform/live/v1/customer-directory/search?q=" +
            Uri.EscapeDataString(customerNumber) +
            "&page=1&pageSize=50";
        var response = await GetAsync(path, cancellationToken);
        var exact = response.Items
            .Where(item => string.Equals(
                item.CustomerNumber?.Trim(),
                customerNumber,
                StringComparison.Ordinal))
            .ToArray();
        if (exact.Length > 1)
            throw new InvalidOperationException(
                $"Canonical customer number collision: {customerNumber}.");
        return exact.Length == 1
            ? new CanonicalCustomer(
                exact[0].CustomerNumber.Trim(),
                exact[0].CustomerName.Trim())
            : null;
    }

    public async Task<IReadOnlyList<CanonicalCustomer>> GetAllAsync(
        CancellationToken cancellationToken)
    {
        var customers = new List<CanonicalCustomer>();
        var page = 1;
        long totalPages;
        do
        {
            var response = await GetAsync(
                "/api/platform/live/v1/customer-directory/search?page=" +
                page + "&pageSize=50",
                cancellationToken);
            customers.AddRange(response.Items.Select(item =>
                new CanonicalCustomer(
                    item.CustomerNumber.Trim(),
                    item.CustomerName.Trim())));
            totalPages = response.TotalPages;
            page++;
        } while (page <= totalPages);

        var collision = customers
            .GroupBy(item => item.CustomerNumber, StringComparer.Ordinal)
            .FirstOrDefault(group => group.Count() > 1);
        if (collision is not null)
            throw new InvalidOperationException(
                $"Canonical customer number collision: {collision.Key}.");
        return customers;
    }

    private async Task<CustomerDirectoryResponse> GetAsync(
        string path,
        CancellationToken cancellationToken)
    {
        using var response = await _httpClient.GetAsync(path, cancellationToken);
        if (response.StatusCode == HttpStatusCode.Unauthorized)
            throw new UnauthorizedAccessException(
                "The Customer Files service was not authorized by the canonical API.");
        response.EnsureSuccessStatusCode();
        return await response.Content.ReadFromJsonAsync<CustomerDirectoryResponse>(
            cancellationToken: cancellationToken)
            ?? throw new InvalidOperationException(
                "The canonical Customer Directory returned no response.");
    }
}
