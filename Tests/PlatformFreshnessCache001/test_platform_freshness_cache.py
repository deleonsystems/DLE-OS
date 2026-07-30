from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[2]
TOOL = ROOT / "Tools" / "PlatformFreshnessCache"
ARTIFACT = (
    ROOT
    / "Artifacts"
    / "PlatformFreshnessCache001"
    / "PLATFORMFRESHNESSCACHE001-20260730T010815Z"
)

checks: list[tuple[str, bool]] = []


def require(name: str, condition: bool) -> None:
    checks.append((name, bool(condition)))


contract = (ARTIFACT / "PLATFORM_FRESHNESS_CACHE_CONTRACT.md").read_text(encoding="utf-8")
publisher = (TOOL / "Publish-VersionedFrontend.ps1").read_text(encoding="utf-8")
rollback = (TOOL / "Rollback-VersionedFrontend.ps1").read_text(encoding="utf-8")
hosting = (
    TOOL / "ServerOverlay" / "Hosting" / "FrontendApplicationExtensions.cs"
).read_text(encoding="utf-8")
repository = (
    TOOL
    / "ServerOverlay"
    / "Data"
    / "Platform"
    / "LivePlatformStatusRepository.cs"
).read_text(encoding="utf-8")
options = (
    TOOL / "ServerOverlay" / "Options" / "LiveApiOptions.cs"
).read_text(encoding="utf-8")
dto = (
    TOOL / "ServerOverlay" / "Contracts" / "Platform" / "LivePlatformDtos.cs"
).read_text(encoding="utf-8")
schema = (
    TOOL / "Database" / "032_AddLiveSnapshotOperationalStatus.sql"
).read_text(encoding="utf-8")
runner = (
    ROOT / "Tools" / "LiveSnapshotRefresh" / "Invoke-LiveSnapshotRefresh.ps1"
).read_text(encoding="utf-8")
promotion = (
    ROOT
    / "Tools"
    / "LiveSnapshotRefresh"
    / "Complete-LiveSnapshotPromotion.ps1"
).read_text(encoding="utf-8")
viewer = (
    ROOT
    / "SRC"
    / "modules"
    / "canonical-data-viewer"
    / "canonical-data-viewer.js"
).read_text(encoding="utf-8")
template = (
    ROOT
    / "SRC"
    / "modules"
    / "canonical-data-viewer"
    / "canonical-data-viewer.html"
).read_text(encoding="utf-8")

require("01_contract_frozen_before_implementation", "FROZEN FOR IMPLEMENTATION" in contract)
require("02_unique_build_id", "yyyyMMddTHHmmssZ" in publisher and "Substring(0, 12)" in publisher)
require("03_versioned_asset_paths", "/assets/$buildId/SRC/" in publisher)
require("04_shell_current_build_only", "dle-frontend-build-id" in publisher)
require("05_shell_no_store", "no-store, no-cache, must-revalidate" in hosting)
require("06_assets_immutable", "max-age=31536000, immutable" in hosting)
require("07_atomic_build_publication", "Move-Item -LiteralPath $stageRoot -Destination $finalBuild" in publisher)
require("08_atomic_pointer_publication", "Move-Item" in publisher and "current-release.json" in publisher)
require("09_previous_build_rollback", "previous-release.json" in rollback and "rollback-current" in rollback)
require("10_root_is_canonical", 'app.MapGet("/", ServeShell)' in hosting)
require("11_app_redirects", 'app.MapGet(\n            "/app"' in hosting and "Results.Redirect" in hosting)
require("12_loaded_build_diagnostic", "loadedFrontendBuildId" in publisher and "Loaded frontend build" in template)
require("13_mismatch_detection", "DLEFrontendBuildMismatch" in publisher and "recoveryStarted" in viewer)
require("14_bounded_reload", 'sessionStorage.getItem(recoveryKey) !== "attempted"' in publisher)
require(
    "15_no_manual_asset_query_versioning",
    r"\?v=" in publisher and "Manual query parameters" in contract,
)
require("16_snapshot_as_of_api", "SnapshotAsOfUtc" in dto and "snapshotAsOfUtc" in contract)
require("17_source_checked_api", "SourceCheckedAtUtc" in dto and "source-checked-at" in template)
require("18_qualification_completed_api", "QualificationCompletedAtUtc" in dto and "qualification-at" in template)
require("19_warning_threshold_config", "SnapshotWarningMinutes" in options)
require("20_source_warning_config", "SourceCheckWarningMinutes" in options)
require("21_source_hard_expiration_config", "SourceCheckHardExpirationMinutes" in options)
require("22_qualification_warning_config", "QualificationWarningMinutes" in options)
require("23_snapshot_age_warning_not_hard", "ReadySourceRechecked" in repository)
require("24_source_expiration_hard", "NotReadySourceCheckExpired" in repository)
require("25_source_changed_hard", "NotReadySourceChanged" in repository)
require("26_contract_mismatch_hard", "NotReadyContractMismatch" in repository)
require("27_package_mismatch_hard", "NotReadyPackageMismatch" in repository)
require("28_sql_mismatch_hard", "NotReadySqlMismatch" in repository)
require("29_no_change_proc_updates_source_only", "RecordLiveSourceCheck" in schema and "SourceCheckedAtUtc = @CheckedAtUtc" in schema)
require("30_no_change_preserves_snapshot_identity", "UPDATE platform.LiveSnapshotOperationalStatus\n        SET SourceCheckedAtUtc" in schema)
require("31_changed_check_does_not_update_checked_at", "SET LastSourceCheckResult = @Result,\n            SourceChangeStatus = N'Changed'" in schema)
require("32_runner_records_no_change", "Write-SqlSourceCheck" in runner and "'NO_SOURCE_CHANGES'" in runner)
require("33_force_full_remains_explicit", "ForceFullExtraction" in runner and "Get-LiveSnapshotRefreshDisposition" in runner)
require("34_full_promotion_updates_all_timestamps", "Write-LiveFullQualification" in promotion)
require("35_invoice_refresh_independent", "Invoice History refresh remains independent" in contract)
require(
    "36_existing_operator_user_mapping_is_reused",
    "SUSER_SID(N'DLE-OS-HOST\\DLE-OS')" in schema
    and "QUOTENAME(@ApprovedRefreshUser)" in schema
    and "EXEC sys.sp_executesql @PermissionStatement" in schema,
)
require(
    "37_operational_timestamps_preserve_datetime2_precision",
    "[Data.SqlDbType]::DateTime2" in runner
    and "[Data.SqlDbType]::DateTime2" in promotion
    and "snapshotParameter.Scale = 7"
    in (TOOL / "Deploy-PlatformFreshnessCache.ps1").read_text(encoding="utf-8"),
)
deployment = (TOOL / "Deploy-PlatformFreshnessCache.ps1").read_text(encoding="utf-8")
require(
    "38_historical_runtime_stops_before_build_output_replacement",
    deployment.index("Stop-HistoricalRuntime\n    $buildOutput")
    < deployment.index("'DLE-OS-Server.csproj'"),
)
require(
    "39_runtime_acl_recovery_preserves_dedicated_identity",
    deployment.count("Set-LiveRuntimeReadExecuteAcl $liveRuntimeRoot") == 2
    and "[Security.AccessControl.FileSystemRights]::ReadAndExecute" in deployment
    and "DLE-OS-HOST\\DLE-OS-LIVE-API" in deployment,
)
require(
    "40_diagnostic_injection_targets_first_document_head_only",
    "$text.Insert(" in publisher
    and "$headIndex + '<head>'.Length" in publisher
    and "$text.Replace(\n                    '<head>'" not in publisher,
)
frontend_deployer = (TOOL / "Deploy-VersionedFrontend.ps1").read_text(
    encoding="utf-8"
)
require(
    "41_frontend_deployment_is_fixed_scope_and_elevated",
    "C:\\DLE-OS\\Repositories\\DLE-OS" in frontend_deployer
    and "C:\\ProgramData\\DLE-OS\\Frontend" in frontend_deployer
    and "-Verb RunAs" in frontend_deployer
    and "SourceAccessPerformed = $false" in frontend_deployer,
)
require(
    "42_automatic_recovery_returns_to_canonical_root",
    'location.replace("/");' in publisher
    and "build-recovery=" not in publisher,
)

failed = [name for name, passed in checks if not passed]
if failed:
    for name in failed:
        print(f"FAIL: {name}")
    raise SystemExit(1)

print(f"PLATFORM-FRESHNESS-CACHE-001 static qualification: {len(checks)}/{len(checks)} PASS")
