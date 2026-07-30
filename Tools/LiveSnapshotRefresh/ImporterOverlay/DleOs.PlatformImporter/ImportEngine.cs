namespace DleOs.PlatformImporter;

public sealed class ImportEngine
{
    public async Task<ImportExecutionResult> ExecuteAsync(
        ImportOptions options,
        CancellationToken cancellationToken = default)
    {
        var startedAt = DateTimeOffset.UtcNow;
        var profile = options.Profile;
        var artifactRoot = Safety.RequireArtifactsPath(
            profile.ArtifactsRoot,
            profile);

        try
        {
            if (options.PackageSlot == PackageSlot.Previous &&
                profile.EnvironmentId != ImportProfiles.Live)
            {
                throw new PlatformImportException(
                    "RESTORE_PROFILE_NOT_APPROVED",
                    "The fixed Previous-package restoration slot is " +
                    "approved only for LIVE.");
            }
            if (options.RequalifyCurrentPackage &&
                (profile.EnvironmentId != ImportProfiles.Live ||
                 options.PackageSlot != PackageSlot.Current ||
                 options.RequireRestoration))
            {
                throw new PlatformImportException(
                    "REFRESH_IMPORT_BOUNDARY_INVALID",
                    "Identical-content refresh import is approved only for " +
                    "the fixed LIVE Current package and is not a restore.");
            }
            var configuredSource =
                options.PackageSlot == PackageSlot.Previous
                    ? PlatformConstants.LiveMirrorPreviousPackagePath
                    : profile.SourcePath;
            var mirrorPath = Safety.RequireExactPath(
                configuredSource,
                configuredSource);
            var contractPath = Safety.RequireExactPath(
                PlatformConstants.ContractPath,
                PlatformConstants.ContractPath);

            var contract = ContractLoader.LoadAndValidate(contractPath);
            var snapshot = profile.PackageFormat == PackageFormat.LiveCanonical
                ? await LiveCanonicalPackageValidator.ValidateAndLoadAsync(
                    mirrorPath,
                    contract,
                    cancellationToken)
                : CanonicalMapper.Map(
                    contract,
                    await PackageValidator.ValidateAsync(
                        mirrorPath,
                        contract,
                        cancellationToken));

            var store = new SqlPlatformStore(
                profile.ConnectionString,
                profile);
            await store.EnsureSchemaAsync(cancellationToken);
            var result = await store.ImportAsync(
                snapshot,
                options.FailureInjection,
                cancellationToken,
                options.RequireRestoration,
                options.RequalifyCurrentPackage);
            await ArtifactWriter.WriteImportResultAsync(
                artifactRoot,
                result,
                cancellationToken);
            return result;
        }
        catch (Exception exception)
        {
            var code = exception is PlatformImportException platformException
                ? platformException.Code
                : exception is OperationCanceledException
                    ? "IMPORT_INTERRUPTED"
                    : "IMPORT_FAILED";
            var result = new ImportExecutionResult
            {
                ImportRunId = Guid.NewGuid(),
                MirrorRunId = string.Empty,
                PackageHash = string.Empty,
                EnvironmentId = profile.EnvironmentId,
                Status = exception is OperationCanceledException
                    ? "INTERRUPTED"
                    : "FAILED",
                IsCommitted = false,
                IsNoOp = false,
                StartedAtUtc = startedAt,
                CompletedAtUtc = DateTimeOffset.UtcNow,
                FailureCode = code,
                FailureMessage = exception.Message,
                TotalExpectedRows = 0,
                TotalSqlRows = 0,
                Entities = [],
                Audit =
                [
                    new ImportAuditEvent
                    {
                        Severity = "ERROR",
                        EventCode = code,
                        Message = exception.Message
                    }
                ]
            };
            await ArtifactWriter.WriteImportResultAsync(
                artifactRoot,
                result,
                CancellationToken.None);
            return result;
        }
    }
}
