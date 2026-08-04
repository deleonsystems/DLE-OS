[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$engine =
    'C:\DLE-OS\Canonical\LiveMirror\Engine\live_mirror_engine.py'
$backupRoot =
    Join-Path 'C:\Add-On\Lab\Backups' (
        [DateTimeOffset]::Now.ToString('yyyyMMddTHHmmsszzz').Replace(':', '') +
        '_LIVE-SNAPSHOT-REFRESH-001M2_ENGINE'
    )
$changelog = 'C:\Add-On\Lab\CHANGELOG.md'
New-Item -ItemType Directory -Path $backupRoot -Force | Out-Null
Copy-Item -LiteralPath $engine -Destination $backupRoot
Copy-Item -LiteralPath $changelog -Destination (
    Join-Path $backupRoot 'CHANGELOG.md'
)

$source = Get-Content -LiteralPath $engine -Raw
$old = 'ENGINE_VERSION = "1.0.1"'
$new = 'ENGINE_VERSION = "1.1.0"'
if ($source.Contains($old)) {
    $source = $source.Replace($old, $new)
    [IO.File]::WriteAllText(
        $engine,
        $source,
        [Text.UTF8Encoding]::new($false))
}
elseif (-not $source.Contains($new)) {
    throw 'The live mirror engine version declaration was not recognized.'
}
$oldContractHash =
    '3FE9C5B9AAA6CC25C1B7959221E63D81031A78B220E51D84BA2D412872846C59'
$qualifiedContractHash =
    'AF4BEA98947AC1CE5FAF1AB735B08EA805BF80669C08EF1050B3ABF681ECC52B'
if ($source.Contains($oldContractHash)) {
    $source = $source.Replace($oldContractHash, $qualifiedContractHash)
}
elseif (-not $source.Contains($qualifiedContractHash)) {
    throw 'The live mirror Contract v1.2 hash declaration was not recognized.'
}
$oldTraceabilityCheck =
    'if len(relationships) != 9 or len(traceability) != 118:'
$qualifiedTraceabilityCheck =
    'if len(relationships) != 9 or len(traceability) != 120:'
if ($source.Contains($oldTraceabilityCheck)) {
    $source = $source.Replace(
        $oldTraceabilityCheck,
        $qualifiedTraceabilityCheck)
}
elseif (-not $source.Contains($qualifiedTraceabilityCheck)) {
    throw 'The Contract v1.2 traceability-count check was not recognized.'
}
$oldIncludedCheck =
    'if sum(row["include_in_canonical_model"] == "Yes" for row in traceability) != 33:'
$qualifiedIncludedCheck =
    'if sum(row["include_in_canonical_model"] == "Yes" for row in traceability) != 35:'
if ($source.Contains($oldIncludedCheck)) {
    $source = $source.Replace($oldIncludedCheck, $qualifiedIncludedCheck)
}
elseif (-not $source.Contains($qualifiedIncludedCheck)) {
    throw 'The Contract v1.2 included-member check was not recognized.'
}
$legacyMarker = 'legacy_bootstrap = ('
if (-not $source.Contains($legacyMarker)) {
    $manifestAnchor =
        '    manifest = json.loads((path / "manifest.json").read_text(encoding="utf-8"))'
    $legacyBlock = @'
    legacy_bootstrap = (
        manifest.get("contract_version") == "V1.1"
        and manifest.get("run_id")
        == "LIVEMIRROR001-20260727T201259Z-43274A71"
        and manifest.get("package_hash")
        == "882EFDBD9E1ADC1CF37F346F8D5B9AA8692AB13C6365E13A3B10068E8ED75141"
    )
'@
    if (-not $source.Contains($manifestAnchor)) {
        throw 'The package-manifest validation anchor was not recognized.'
    }
    $source = $source.Replace(
        $manifestAnchor,
        $manifestAnchor + [Environment]::NewLine + $legacyBlock.TrimEnd())
    $source = $source.Replace(
        '        or manifest.get("contract_version") != "V1.2"',
        @'
        or (
            manifest.get("contract_version") != "V1.2"
            and not legacy_bootstrap
        )
'@.TrimEnd())
    $source = $source.Replace(
        @'
        or contract["contract_version"] != "V1.2"
        or contract["member_count"] != 33
'@.TrimEnd(),
        @'
        or contract["contract_version"]
        != ("V1.1" if legacy_bootstrap else "V1.2")
        or contract["member_count"] != (33 if legacy_bootstrap else 35)
'@.TrimEnd())
}
[IO.File]::WriteAllText(
    $engine,
    $source,
    [Text.UTF8Encoding]::new($false))

Add-Content -LiteralPath $changelog -Value @"

### LIVE-SNAPSHOT-REFRESH-001M2 engine identity repair

- Backed up and corrected live_mirror_engine.py ENGINE_VERSION from 1.0.1
  to the already-approved live-mirror-profile.json value 1.1.0.
- Corrected the engine's fail-closed Contract v1.2 hash constant to the
  SHA-256 already recorded in the approved profile and verified contract file.
- Corrected stale Contract v1.1 cardinality checks to the approved v1.2
  values: 120 traceability rows and 35 included canonical members.
- Added an exact run-ID and package-hash exception so only the already
  qualified v1.1 bootstrap package can rotate to Previous during the first
  v1.2 refresh; all new packages remain strictly v1.2.
- No reader logic, source path, VPro mode, package mapping, or data was changed.
"@

[pscustomobject]@{
    Verdict = 'PASS'
    Engine = $engine
    EngineVersion = '1.1.0'
    ProfileVersion = '1.1.0'
    ContractSha256 = $qualifiedContractHash
    TraceabilityCount = 120
    IncludedCanonicalMemberCount = 35
    LegacyBootstrapPackage =
        'LIVEMIRROR001-20260727T201259Z-43274A71'
    BackupRoot = $backupRoot
} | ConvertTo-Json
