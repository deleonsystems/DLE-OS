using Dapper;
using DLE_OS_Server.Contracts.Platform;
using DLE_OS_Server.Models.Platform;
using DLE_OS_Server.Options;
using Microsoft.Data.SqlClient;
using Microsoft.Extensions.Options;

namespace DLE_OS_Server.Data.Platform.Live;

public sealed class LivePlatformStatusRepository
    : ILivePlatformStatusRepository
{
    private const string SnapshotSql = """
SELECT
    snapshot.ImportRunId,
    snapshot.EnvironmentId,
    snapshot.MirrorRunId,
    snapshot.PackageHash,
    snapshot.ContractVersion,
    snapshot.SnapshotTimestampUtc,
    snapshot.SnapshotAgeSeconds,
    status.SourceCheckedAtUtc,
    DATEDIFF_BIG(SECOND, status.SourceCheckedAtUtc, SYSUTCDATETIME())
        AS SourceCheckAgeSeconds,
    status.QualificationCompletedAtUtc,
    DATEDIFF_BIG(
        SECOND,
        status.QualificationCompletedAtUtc,
        SYSUTCDATETIME()) AS QualificationAgeSeconds,
    status.LastSourceCheckResult,
    status.SourceChangeStatus,
    status.SourceIndicatorFingerprint,
    status.LastFullExtractionRunId,
    status.LastForceFullIntent,
    snapshot.BillOfMaterialCount,
    snapshot.InventoryItemCount,
    snapshot.WorkOrderCount,
    snapshot.GeneralLedgerAccountCount,
    snapshot.TotalCount
FROM liveapi.SnapshotMetadata AS snapshot
JOIN liveapi.SnapshotOperationalStatus AS status
    ON status.ImportRunId = snapshot.ImportRunId;
""";

    private const string ApiContractVersion = "live-readiness-v2";

    private readonly LivePlatformSqlConnectionFactory _connectionFactory;
    private readonly LiveApiOptions _options;
    private readonly ILogger<LivePlatformStatusRepository> _logger;

    public LivePlatformStatusRepository(
        LivePlatformSqlConnectionFactory connectionFactory,
        IOptions<LiveApiOptions> options,
        ILogger<LivePlatformStatusRepository> logger)
    {
        _connectionFactory = connectionFactory;
        _options = options.Value;
        _logger = logger;
    }

    public async Task<LiveSnapshotMetadataDto?> GetSnapshotAsync(
        CancellationToken cancellationToken)
    {
        var row = await ReadSnapshotRowAsync(cancellationToken);
        return row is null ? null : CreateSnapshot(row);
    }

    public async Task<LiveApiReadinessDto> GetReadinessAsync(
        CancellationToken cancellationToken)
    {
        try
        {
            var row = await ReadSnapshotRowAsync(cancellationToken);
            if (row is null)
            {
                return Unavailable(
                    "No joined qualified snapshot and operational status row is available.");
            }

            var evaluation = Evaluate(row, _options);
            return new LiveApiReadinessDto
            {
                DataEnvironment = _options.DataEnvironment,
                Database = _options.Database,
                ContractVersion = _options.ContractVersion,
                ApiContractVersion = ApiContractVersion,
                ReadinessVerdict = evaluation.Verdict,
                ReadinessState = evaluation.State,
                ReadinessReason = evaluation.Reason,
                CurrentImportRunId = row.ImportRunId,
                MirrorRunId = row.MirrorRunId,
                PackageHash = row.PackageHash,
                SnapshotTimestampUtc = AsUtc(row.SnapshotTimestampUtc),
                SnapshotAsOfUtc = AsUtc(row.SnapshotTimestampUtc),
                SnapshotAgeSeconds = row.SnapshotAgeSeconds,
                SourceCheckedAtUtc = AsUtc(row.SourceCheckedAtUtc),
                SourceCheckAgeSeconds = row.SourceCheckAgeSeconds,
                QualificationCompletedAtUtc =
                    AsUtc(row.QualificationCompletedAtUtc),
                QualificationAgeSeconds = row.QualificationAgeSeconds,
                SourceChangeStatus = row.SourceChangeStatus,
                LastSourceCheckResult = row.LastSourceCheckResult,
                FreshnessStatus = evaluation.FreshnessStatus,
                Warnings = evaluation.Warnings,
                HardFailures = evaluation.HardFailures,
                EntityCounts = Counts(row),
                TotalCount = row.TotalCount,
                Checks = evaluation.Checks
            };
        }
        catch (Exception exception) when (
            !cancellationToken.IsCancellationRequested &&
            exception is SqlException or InvalidOperationException or TimeoutException)
        {
            _logger.LogWarning(
                exception,
                "Live API readiness database probe failed.");
            return Unavailable(
                "The qualified live canonical database or status boundary is unavailable.");
        }
    }

    private async Task<LiveSnapshotRow?> ReadSnapshotRowAsync(
        CancellationToken cancellationToken)
    {
        await using var connection = _connectionFactory.CreateConnection();
        await connection.OpenAsync(cancellationToken);
        return await connection.QuerySingleOrDefaultAsync<LiveSnapshotRow>(
            new CommandDefinition(
                SnapshotSql,
                cancellationToken: cancellationToken));
    }

    private LiveSnapshotMetadataDto CreateSnapshot(LiveSnapshotRow row)
    {
        var evaluation = Evaluate(row, _options);
        return new LiveSnapshotMetadataDto
        {
            DataEnvironment = _options.DataEnvironment,
            Database = _options.Database,
            ContractVersion = _options.ContractVersion,
            ApiContractVersion = ApiContractVersion,
            ReadinessVerdict = evaluation.Verdict,
            ReadinessState = evaluation.State,
            ReadinessReason = evaluation.Reason,
            CurrentImportRunId = row.ImportRunId,
            MirrorRunId = row.MirrorRunId,
            PackageHash = row.PackageHash,
            SnapshotTimestampUtc = AsUtc(row.SnapshotTimestampUtc),
            SnapshotAsOfUtc = AsUtc(row.SnapshotTimestampUtc),
            SnapshotAgeSeconds = row.SnapshotAgeSeconds,
            SourceCheckedAtUtc = AsUtc(row.SourceCheckedAtUtc),
            SourceCheckAgeSeconds = row.SourceCheckAgeSeconds,
            QualificationCompletedAtUtc =
                AsUtc(row.QualificationCompletedAtUtc),
            QualificationAgeSeconds = row.QualificationAgeSeconds,
            SourceChangeStatus = row.SourceChangeStatus,
            LastSourceCheckResult = row.LastSourceCheckResult,
            FreshnessStatus = evaluation.FreshnessStatus,
            Warnings = evaluation.Warnings,
            HardFailures = evaluation.HardFailures,
            EntityCounts = Counts(row),
            TotalCount = row.TotalCount
        };
    }

    private static Evaluation Evaluate(
        LiveSnapshotRow row,
        LiveApiOptions options)
    {
        var checks = BuildStructuralChecks(row, options);
        var hardFailures = checks
            .Where(check => !check.Passed)
            .Select(check => check.Message)
            .ToList();

        string? hardState = null;
        if (string.Equals(
                row.SourceChangeStatus,
                "Changed",
                StringComparison.Ordinal))
        {
            hardState = "NotReadySourceChanged";
            hardFailures.Add(
                "Approved source indicators changed; full extraction is required.");
        }
        else if (row.SourceCheckAgeSeconds < 0 ||
                 row.SourceCheckAgeSeconds >
                    MinutesToSeconds(options.SourceCheckHardExpirationMinutes))
        {
            hardState = "NotReadySourceCheckExpired";
            hardFailures.Add(
                "The successful approved-source check has expired.");
        }
        else if (checks.Any(check =>
                     !check.Passed &&
                     check.Name == "contractVersion"))
        {
            hardState = "NotReadyContractMismatch";
        }
        else if (checks.Any(check =>
                     !check.Passed &&
                     check.Name is "packageHash" or "importRun" or "mirrorRun"))
        {
            hardState = "NotReadyPackageMismatch";
        }
        else if (checks.Any(check => !check.Passed))
        {
            hardState = "NotReadySqlMismatch";
        }

        if (hardState is not null)
        {
            return new Evaluation(
                "NotReady",
                hardState,
                hardFailures[0],
                "Unavailable",
                [],
                hardFailures,
                checks);
        }

        var warnings = new List<string>();
        var snapshotWarns =
            row.SnapshotAgeSeconds >
                MinutesToSeconds(options.SnapshotWarningMinutes);
        var sourceWarns =
            row.SourceCheckAgeSeconds >
                MinutesToSeconds(options.SourceCheckWarningMinutes);
        var qualificationWarns =
            row.QualificationAgeSeconds >
                MinutesToSeconds(options.QualificationWarningMinutes);

        if (snapshotWarns)
        {
            warnings.Add(
                "The data snapshot is older than the preferred 24-hour age.");
        }
        if (sourceWarns)
        {
            warnings.Add(
                "The approved ERP source check is older than the preferred age.");
        }
        if (qualificationWarns)
        {
            warnings.Add(
                "The full snapshot qualification is older than the preferred age.");
        }

        if (!snapshotWarns && !sourceWarns)
        {
            return new Evaluation(
                "Ready",
                "ReadyFresh",
                "Snapshot and approved source check are within warning thresholds.",
                "Fresh",
                warnings,
                [],
                checks);
        }

        if (snapshotWarns && !sourceWarns)
        {
            return new Evaluation(
                "Ready",
                "ReadySourceRechecked",
                "ERP source indicators were checked recently and remain unchanged; the data snapshot is older than preferred.",
                "SourceRechecked",
                warnings,
                [],
                checks);
        }

        return new Evaluation(
            "Ready",
            "ReadyWithStaleSnapshotWarning",
            "The snapshot remains qualified, but age warnings require operator attention.",
            "Warning",
            warnings,
            [],
            checks);
    }

    private static IReadOnlyList<ApiReadinessCheckDto> BuildStructuralChecks(
        LiveSnapshotRow row,
        LiveApiOptions options)
    {
        var configuredCounts =
            row.BillOfMaterialCount == options.ExpectedBillOfMaterialCount &&
            row.InventoryItemCount == options.ExpectedInventoryItemCount &&
            row.WorkOrderCount == options.ExpectedWorkOrderCount &&
            row.GeneralLedgerAccountCount ==
                options.ExpectedGeneralLedgerAccountCount &&
            row.TotalCount == options.ExpectedTotalCount;
        var selfQualifiedOperationalSnapshot =
            options.AcceptLatestQualifiedOperationalSnapshot &&
            string.Equals(row.SourceChangeStatus, "Qualified", StringComparison.Ordinal) &&
            string.Equals(row.LastSourceCheckResult, "DAILY_OPERATIONS_SYNC_QUALIFIED",
                StringComparison.Ordinal) &&
            row.ImportRunId != Guid.Empty &&
            row.MirrorRunId.StartsWith("DAILYOPSSYNC-", StringComparison.Ordinal) &&
            row.PackageHash.Length == 64 &&
            row.BillOfMaterialCount >= 0 && row.InventoryItemCount >= 0 &&
            row.WorkOrderCount >= 0 && row.GeneralLedgerAccountCount >= 0 &&
            row.TotalCount == row.BillOfMaterialCount + row.InventoryItemCount +
                row.WorkOrderCount + row.GeneralLedgerAccountCount;

        return
        [
            Check(
                "dataEnvironment",
                string.Equals(
                    row.EnvironmentId,
                    options.DataEnvironment,
                    StringComparison.Ordinal),
                $"Snapshot environment is {row.EnvironmentId}."),
            Check(
                "database",
                string.Equals(
                    options.Database,
                    LivePlatformSqlConnectionFactory.DatabaseName,
                    StringComparison.Ordinal),
                $"Configured live database is {options.Database}."),
            Check(
                "contractVersion",
                string.Equals(
                    row.ContractVersion,
                    options.StoredContractVersion,
                    StringComparison.Ordinal),
                $"Stored contract version is {row.ContractVersion}."),
            Check(
                "importRun",
                selfQualifiedOperationalSnapshot || row.ImportRunId == options.ExpectedImportRunId,
                $"Current ImportRunId is {row.ImportRunId:D}."),
            Check(
                "mirrorRun",
                selfQualifiedOperationalSnapshot || string.Equals(
                    row.MirrorRunId, options.ExpectedMirrorRunId, StringComparison.Ordinal),
                $"Current MirrorRunId is {row.MirrorRunId}."),
            Check(
                "packageHash",
                selfQualifiedOperationalSnapshot || string.Equals(
                    row.PackageHash, options.ExpectedPackageHash, StringComparison.Ordinal),
                "Current package hash matches the qualified package."),
            Check(
                "entityCounts",
                selfQualifiedOperationalSnapshot || configuredCounts,
                $"Counts are BOM={row.BillOfMaterialCount}, Inventory={row.InventoryItemCount}, WorkOrder={row.WorkOrderCount}, GL={row.GeneralLedgerAccountCount}, Total={row.TotalCount}."),
            Check(
                "operationalStatus",
                row.SourceCheckedAtUtc != default &&
                row.QualificationCompletedAtUtc != default &&
                !string.IsNullOrWhiteSpace(row.SourceIndicatorFingerprint) &&
                (!options.AcceptLatestQualifiedOperationalSnapshot ||
                    selfQualifiedOperationalSnapshot),
                "Separated snapshot/source-check/qualification status is present.")
        ];
    }

    private LiveApiReadinessDto Unavailable(string message) =>
        new()
        {
            DataEnvironment = _options.DataEnvironment,
            Database = _options.Database,
            ContractVersion = _options.ContractVersion,
            ApiContractVersion = ApiContractVersion,
            ReadinessVerdict = "NotReady",
            ReadinessState = "NotReadyRuntimeFailure",
            ReadinessReason = message,
            CurrentImportRunId = null,
            MirrorRunId = null,
            PackageHash = null,
            SnapshotTimestampUtc = null,
            SnapshotAsOfUtc = null,
            SnapshotAgeSeconds = null,
            SourceCheckedAtUtc = null,
            SourceCheckAgeSeconds = null,
            QualificationCompletedAtUtc = null,
            QualificationAgeSeconds = null,
            SourceChangeStatus = "Unknown",
            LastSourceCheckResult = "UNAVAILABLE",
            FreshnessStatus = "Unavailable",
            Warnings = [],
            HardFailures = [message],
            EntityCounts = new SnapshotEntityCountsDto
            {
                BillOfMaterial = 0,
                InventoryItem = 0,
                WorkOrder = 0,
                GeneralLedgerAccount = 0
            },
            TotalCount = 0,
            Checks = [Check("liveDatabase", false, message)]
        };

    private static SnapshotEntityCountsDto Counts(LiveSnapshotRow row) =>
        new()
        {
            BillOfMaterial = row.BillOfMaterialCount,
            InventoryItem = row.InventoryItemCount,
            WorkOrder = row.WorkOrderCount,
            GeneralLedgerAccount = row.GeneralLedgerAccountCount
        };

    private static ApiReadinessCheckDto Check(
        string name,
        bool passed,
        string message) =>
        new()
        {
            Name = name,
            Passed = passed,
            Message = message
        };

    private static DateTime AsUtc(DateTime value) =>
        value.Kind == DateTimeKind.Utc
            ? value
            : DateTime.SpecifyKind(value, DateTimeKind.Utc);

    private static long MinutesToSeconds(int minutes) =>
        checked((long)minutes * 60);

    private sealed record Evaluation(
        string Verdict,
        string State,
        string Reason,
        string FreshnessStatus,
        IReadOnlyList<string> Warnings,
        IReadOnlyList<string> HardFailures,
        IReadOnlyList<ApiReadinessCheckDto> Checks);
}
