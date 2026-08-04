namespace DLE_OS_Server.Options;

public sealed class FrontendOptions
{
    public const string SectionName = "Frontend";

    public static readonly string[] MutableSourceDirectories =
    [
        "SRC",
        "ASSETS"
    ];

    public static readonly string[] RuntimeDataDirectories =
    [
        "DATA",
        "TEST_DATA"
    ];

    public string RootPath { get; init; } = string.Empty;
    public string EntryFile { get; init; } = string.Empty;
    public string PublicationRoot { get; init; } = string.Empty;
}
