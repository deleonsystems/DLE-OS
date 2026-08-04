from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
RUNNER = (
    ROOT / "Tools" / "LiveSnapshotRefresh" / "Invoke-LiveSnapshotRefresh.ps1"
).read_text(encoding="utf-8")
DECISION = (
    ROOT / "Tools" / "LiveSnapshotRefresh" / "RefreshDecision.psm1"
).read_text(encoding="utf-8")
NORMAL_LAUNCHER = (
    ROOT / "Tools" / "LiveSnapshotRefresh" / "Start-LiveSnapshotRefresh.cmd"
).read_text(encoding="utf-8")
FORCE_LAUNCHER = (
    ROOT
    / "Tools"
    / "LiveSnapshotRefresh"
    / "Start-LiveSnapshotForceFullRefresh.ps1"
).read_text(encoding="utf-8")
CONTROL_HOST = (
    ROOT / "Tools" / "LiveSnapshotRefresh" / "ControlHost" / "Program.cs"
).read_text(encoding="utf-8")
SALES_HELPER = (
    ROOT / "Tools" / "LiveSnapshotRefresh" / "sales_order_refresh.py"
).read_text(encoding="utf-8")
PROMOTION = (
    ROOT
    / "Tools"
    / "LiveSnapshotRefresh"
    / "Complete-LiveSnapshotPromotion.ps1"
).read_text(encoding="utf-8")
IMPORTER_PROGRAM = (
    ROOT
    / "Tools"
    / "LiveSnapshotRefresh"
    / "ImporterOverlay"
    / "DleOs.PlatformImporter"
    / "Program.cs"
).read_text(encoding="utf-8")
IMPORTER_STORE = (
    ROOT
    / "Tools"
    / "LiveSnapshotRefresh"
    / "ImporterOverlay"
    / "DleOs.PlatformImporter"
    / "SqlPlatformStore.cs"
).read_text(encoding="utf-8")


def require(condition: bool, message: str) -> None:
    if not condition:
        raise AssertionError(message)


checks = [
    ("explicit-switch", "[switch] $ForceFullExtraction" in RUNNER),
    (
        "decision-isolated",
        "Get-LiveSnapshotRefreshDisposition" in RUNNER
        and "$disposition -eq 'NO_SOURCE_CHANGES'" in RUNNER,
    ),
    (
        "normal-unchanged",
        "if ($SourceUnchanged -and -not $ForceFullExtraction)" in DECISION,
    ),
    (
        "force-fixture-exclusive",
        "$ForceFullExtraction -and $QualificationCurrentFixture" in RUNNER
        and "$ForceFullExtraction -and $QualificationCurrentFixture" in DECISION,
    ),
    (
        "no-source-state-fabrication",
        "Remove-Item -LiteralPath $sourceStatePath" not in RUNNER
        and "Set-Content -LiteralPath $sourceStatePath" not in RUNNER,
    ),
    (
        "base-extraction-retained",
        "Invoke-Checked $python @($baseEngine, 'run')" in RUNNER,
    ),
    (
        "sales-extraction-retained",
        "$salesHelper," in RUNNER
        and "'Sales Order live extraction'" in RUNNER,
    ),
    (
        "promotion-retained",
        "api/platform/refresh/v1/promote?" in RUNNER
        and "VERIFYING_PROMOTION" in RUNNER,
    ),
    (
        "rollback-retained",
        "PRE_PROMOTION_PACKAGES_RESTORED" in RUNNER,
    ),
    (
        "identity-guard-retained",
        "Manual refresh requires $approvedIdentity" in RUNNER,
    ),
    (
        "ordinary-button-normal",
        "ForceFullExtraction" not in NORMAL_LAUNCHER
        and "force-full" not in CONTROL_HOST.lower(),
    ),
    (
        "operator-launcher-explicit",
        "'-ForceFullExtraction'" in FORCE_LAUNCHER
        and "DLE-OS-HOST\\DLE-OS" in FORCE_LAUNCHER,
    ),
    (
        "intent-evidence",
        "InvocationMode" in RUNNER and "ForceFullExtraction" in RUNNER,
    ),
    (
        "two-pass-sales-retained",
        'runtime / "Pass1"' in SALES_HELPER
        and 'runtime / "Pass2"' in SALES_HELPER
        and 'Path(r"X:\\AON\\ADATA\\WOE-03")' in SALES_HELPER,
    ),
    (
        "read-only-retained",
        'MODE="O_RDONLY"' in SALES_HELPER,
    ),
    (
        "normal-import-no-op-retained",
        'case "import"' in IMPORTER_PROGRAM
        and 'result.Status is "SUCCESS" or "NO-OP"' in IMPORTER_PROGRAM,
    ),
    (
        "refresh-import-live-only",
        'case "refresh-import"' in IMPORTER_PROGRAM
        and "REFRESH_IMPORT_PROFILE_NOT_APPROVED" in IMPORTER_PROGRAM,
    ),
    (
        "refresh-import-transactional",
        "IDENTICAL_CONTENT_REFRESH" in IMPORTER_STORE
        and "IsolationLevel.Serializable" in IMPORTER_STORE
        and 'requalifyCurrentPackage\n            ? "IMPORT"' in IMPORTER_STORE,
    ),
    (
        "promotion-selects-identical-refresh",
        "Get-CurrentCanonicalPackageHash" in PROMOTION
        and "$command = 'refresh-import'" in PROMOTION
        and "Invoke-Importer -AllowFreshIdenticalPackage" in PROMOTION,
    ),
]

for name, passed in checks:
    require(passed, name)

print(
    f"LIVE-SNAPSHOT force-full static qualification: "
    f"{len(checks)}/{len(checks)} PASS"
)
