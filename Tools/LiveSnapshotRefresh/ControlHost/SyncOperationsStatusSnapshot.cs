using System.Text.Json;

internal static class SyncOperationsStatusSnapshot
{
    private const int MaximumAttempts = 8;
    private static readonly TimeSpan RetryDelay = TimeSpan.FromMilliseconds(10);

    internal static byte[]? ReadOptional(string path)
    {
        for (var attempt = 0; attempt < MaximumAttempts; attempt++)
        {
            try
            {
                var bytes = File.ReadAllBytes(path);
                using var document = JsonDocument.Parse(bytes);
                return bytes;
            }
            catch (FileNotFoundException)
            {
                if (attempt == MaximumAttempts - 1)
                    return null;
                Thread.Sleep(RetryDelay);
            }
            catch (DirectoryNotFoundException)
            {
                if (attempt == MaximumAttempts - 1)
                    return null;
                Thread.Sleep(RetryDelay);
            }
            catch (IOException) when (attempt < MaximumAttempts - 1)
            {
                Thread.Sleep(RetryDelay);
            }
            catch (JsonException) when (attempt < MaximumAttempts - 1)
            {
                Thread.Sleep(RetryDelay);
            }
        }
        throw new InvalidOperationException("The status snapshot retry bound was exhausted.");
    }
}
