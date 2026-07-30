namespace DLE_OS_Server.Options;

public static class LiveApiQualifiedBoundary
{
    public const string ConfigurationFileName =
        "live-qualified-boundary.json";
    public const string SectionName = "LiveQualifiedBoundary";

    public static bool Matches(
        LiveApiOptions configured,
        LiveApiOptions qualified) =>
        string.Equals(
            configured.RequiredWindowsIdentity,
            qualified.RequiredWindowsIdentity,
            StringComparison.OrdinalIgnoreCase) &&
        string.Equals(
            configured.DataEnvironment,
            qualified.DataEnvironment,
            StringComparison.Ordinal) &&
        string.Equals(
            configured.Database,
            qualified.Database,
            StringComparison.Ordinal) &&
        string.Equals(
            configured.ContractVersion,
            qualified.ContractVersion,
            StringComparison.Ordinal) &&
        string.Equals(
            configured.StoredContractVersion,
            qualified.StoredContractVersion,
            StringComparison.Ordinal) &&
        configured.ExpectedImportRunId == qualified.ExpectedImportRunId &&
        string.Equals(
            configured.ExpectedMirrorRunId,
            qualified.ExpectedMirrorRunId,
            StringComparison.Ordinal) &&
        string.Equals(
            configured.ExpectedPackageHash,
            qualified.ExpectedPackageHash,
            StringComparison.Ordinal) &&
        configured.ExpectedBillOfMaterialCount ==
            qualified.ExpectedBillOfMaterialCount &&
        configured.ExpectedInventoryItemCount ==
            qualified.ExpectedInventoryItemCount &&
        configured.ExpectedWorkOrderCount ==
            qualified.ExpectedWorkOrderCount &&
        configured.ExpectedGeneralLedgerAccountCount ==
            qualified.ExpectedGeneralLedgerAccountCount &&
        configured.SnapshotWarningMinutes ==
            qualified.SnapshotWarningMinutes &&
        configured.SourceCheckWarningMinutes ==
            qualified.SourceCheckWarningMinutes &&
        configured.SourceCheckHardExpirationMinutes ==
            qualified.SourceCheckHardExpirationMinutes &&
        configured.QualificationWarningMinutes ==
            qualified.QualificationWarningMinutes &&
        configured.WorkOrderNumberWidth == qualified.WorkOrderNumberWidth &&
        string.Equals(
            configured.AllowedBrowserOrigin,
            qualified.AllowedBrowserOrigin,
            StringComparison.Ordinal) &&
        string.Equals(
            configured.StartupEvidencePath,
            qualified.StartupEvidencePath,
            StringComparison.Ordinal);
}
