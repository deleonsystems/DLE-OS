using System.Text.Json;
using DleOs.PlatformImporter;

return await ProgramEntry.RunAsync(args);

public static class ProgramEntry
{
    public static async Task<int> RunAsync(string[] args)
    {
        try
        {
            if (args.Length == 0)
            {
                WriteUsage();
                return 2;
            }

            var command = args[0].ToLowerInvariant();
            var options = ParseOptions(args.Skip(1).ToArray());
            var profile = ImportProfiles.Resolve(
                RequiredOnlyProfile(options));
            switch (command)
            {
                case "initialize":
                    await SqlScriptRunner.InitializeAsync(
                        profile,
                        profile.ConnectionString);
                    Console.WriteLine(
                        $"{profile.DatabaseName} initialization PASS.");
                    return 0;

                case "import":
                {
                    var engine = new ImportEngine();
                    var result = await engine.ExecuteAsync(
                        new ImportOptions(profile));
                    Console.WriteLine(JsonSerializer.Serialize(
                        new
                        {
                            result.ImportRunId,
                            result.EnvironmentId,
                            result.ImportOperation,
                            result.Status,
                            result.ContractVersion,
                            result.TotalSqlRows,
                            result.ArtifactDirectory,
                            result.FailureCode
                        },
                        new JsonSerializerOptions { WriteIndented = true }));
                    return result.Status is "SUCCESS" or "NO-OP" ? 0 : 1;
                }

                case "refresh-import":
                {
                    if (profile.EnvironmentId != ImportProfiles.Live)
                    {
                        throw new PlatformImportException(
                            "REFRESH_IMPORT_PROFILE_NOT_APPROVED",
                            "Identical-content refresh import is approved " +
                            "only for LIVE.");
                    }
                    var engine = new ImportEngine();
                    var result = await engine.ExecuteAsync(
                        new ImportOptions(
                            profile,
                            RequalifyCurrentPackage: true));
                    Console.WriteLine(JsonSerializer.Serialize(
                        new
                        {
                            result.ImportRunId,
                            result.EnvironmentId,
                            result.ImportOperation,
                            result.Status,
                            result.ContractVersion,
                            result.TotalSqlRows,
                            result.ArtifactDirectory,
                            result.FailureCode
                        },
                        new JsonSerializerOptions { WriteIndented = true }));
                    return result.Status == "SUCCESS" ? 0 : 1;
                }

                case "restore":
                {
                    if (profile.EnvironmentId != ImportProfiles.Live)
                    {
                        throw new PlatformImportException(
                            "RESTORE_PROFILE_NOT_APPROVED",
                            "Restore is approved only for LIVE.");
                    }
                    var result = await new ImportEngine().ExecuteAsync(
                        new ImportOptions(
                            profile,
                            FailureInjection.None,
                            PackageSlot.Previous,
                            RequireRestoration: true));
                    Console.WriteLine(JsonSerializer.Serialize(
                        new
                        {
                            result.ImportRunId,
                            result.EnvironmentId,
                            result.ImportOperation,
                            result.Status,
                            result.PackageHash,
                            result.TotalSqlRows,
                            result.ArtifactDirectory,
                            result.FailureCode
                        },
                        new JsonSerializerOptions { WriteIndented = true }));
                    return result.Status == "SUCCESS" ? 0 : 1;
                }

                case "validate":
                    await SqlScriptRunner.ExecuteValidationAsync(
                        profile,
                        profile.ConnectionString);
                    Console.WriteLine(
                        $"{profile.DatabaseName} validation script PASS.");
                    return 0;

                case "inspect":
                    await PlatformInspector.CaptureAsync(
                        profile,
                        profile.ConnectionString,
                        Path.Combine(
                            profile.ArtifactsRoot,
                            "Inspection"));
                    Console.WriteLine(
                        $"Independent {profile.EnvironmentId} inspection " +
                        "captured.");
                    return 0;

                default:
                    WriteUsage();
                    return 2;
            }
        }
        catch (Exception exception)
        {
            var code = exception is PlatformImportException platformException
                ? platformException.Code
                : "UNHANDLED_ERROR";
            Console.Error.WriteLine($"{code}: {exception.Message}");
            return 1;
        }
    }

    private static Dictionary<string, string> ParseOptions(string[] args)
    {
        if (args.Length % 2 != 0)
        {
            throw new PlatformImportException(
                "ARGUMENT_PAIR_REQUIRED",
                "Command options must be supplied as --name value pairs.");
        }

        var result = new Dictionary<string, string>(
            StringComparer.OrdinalIgnoreCase);
        for (var index = 0; index < args.Length; index += 2)
        {
            if (!args[index].StartsWith(
                "--",
                StringComparison.Ordinal))
            {
                throw new PlatformImportException(
                    "ARGUMENT_NAME_INVALID",
                    $"Expected option name; found {args[index]}.");
            }

            if (!result.TryAdd(args[index], args[index + 1]))
            {
                throw new PlatformImportException(
                    "ARGUMENT_DUPLICATE",
                    $"Option was supplied twice: {args[index]}");
            }
        }

        return result;
    }

    private static string Required(
        IReadOnlyDictionary<string, string> options,
        string name)
    {
        if (!options.TryGetValue(name, out var value) ||
            string.IsNullOrWhiteSpace(value))
        {
            throw new PlatformImportException(
                "ARGUMENT_REQUIRED",
                $"Required option is missing: {name}");
        }

        return value;
    }

    private static string RequiredOnlyProfile(
        IReadOnlyDictionary<string, string> options)
    {
        if (options.Count != 1 || !options.ContainsKey("--profile"))
        {
            throw new PlatformImportException(
                "PROFILE_ONLY_INPUT_REQUIRED",
                "Normal operator input accepts only --profile " +
                "HISTORICAL_TEST or --profile LIVE.");
        }

        return Required(options, "--profile");
    }

    private static void WriteUsage()
    {
        Console.Error.WriteLine(
            "Commands: initialize, import, refresh-import, restore, " +
            "validate, inspect. " +
            "Syntax: <command> --profile {HISTORICAL_TEST|LIVE}. " +
            "refresh-import is LIVE-only and requires a new qualified " +
            "mirror run with the current package hash. " +
            "Restore is LIVE-only and reads the fixed Previous slot. " +
            "Source paths, database names, and connection strings are fixed.");
    }
}
