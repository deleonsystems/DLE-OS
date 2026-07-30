[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$root = (
    'C:\DLE-OS\Repositories\DLE-OS\Artifacts\' +
    'EmployeeReferencePlatform001\' +
    'EMPLOYEEREFERENCEPLATFORM001-20260730T122647Z')
$required = @(
    'EMPLOYEE_REFERENCE_PLATFORM_001_FINAL_REPORT.md',
    'EMPLOYEE_REFERENCE_SOURCE_CONTRACT.md',
    'EMPLOYEE_REFERENCE_PROGRAM_AND_FILE_RELATIONSHIPS.md',
    'EMPLOYEE_REFERENCE_PHYSICAL_FIELD_MAP.csv',
    'EMPLOYEE_REFERENCE_PRIVACY_AND_ACCESS_CLASSIFICATION.csv',
    'EMPLOYEE_REFERENCE_OPERATIONAL_CODE_RECONCILIATION.md',
    'EMPLOYEE_REFERENCE_CANONICAL_PROPOSAL.md',
    'EMPLOYEE_REFERENCE_POPULATION_RECONCILIATION.md',
    'EMPLOYEE_REFERENCE_SQL_SCHEMA.md',
    'EMPLOYEE_REFERENCE_BASELINE_EXTRACTION_REPORT.md',
    'EMPLOYEE_REFERENCE_IMPORT_REPORT.md',
    'EMPLOYEE_REFERENCE_API_CONTRACT.md',
    'EMPLOYEE_REFERENCE_BROWSER_ACCEPTANCE.md',
    'EMPLOYEE_REFERENCE_REFRESH_ASSESSMENT.md',
    'EMPLOYEE_REFERENCE_SOURCE_SAFETY_EVIDENCE.md',
    'EMPLOYEE_REFERENCE_HARNESS_RESULT.md',
    'EMPLOYEE_REFERENCE_PRIVACY_VALIDATION.md',
    'EMPLOYEE_REFERENCE_TEST_RESULTS.md',
    'EMPLOYEE_REFERENCE_DATABASE_BOUNDARY_BEFORE.json',
    'EMPLOYEE_REFERENCE_DATABASE_BOUNDARY_AFTER.json',
    'EMPLOYEE_REFERENCE_DEPLOYMENT_20260730T125308Z.json',
    'EMPLOYEE_REFERENCE_HTTP_TEST_RESULTS.json',
    'EMPLOYEE_REFERENCE_SQL_PERMISSION_EVIDENCE.json',
    'EMPLOYEE_REFERENCE_RUNTIME_REGRESSION.json'
)

$rows = foreach ($name in $required) {
    $path = Join-Path $root $name
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
        throw "Missing required retained artifact: $name"
    }
    $item = Get-Item -LiteralPath $path
    [ordered]@{
        Artifact = $name
        Bytes = $item.Length
        Sha256 = (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash
        Classification = 'RETAINED_MISSION_EVIDENCE'
    }
}

$manifest = Join-Path $root 'ARTIFACT_MANIFEST.csv'
$rows | Export-Csv -LiteralPath $manifest -NoTypeInformation -Encoding UTF8
$manifestHash = (Get-FileHash -LiteralPath $manifest -Algorithm SHA256).Hash
[ordered]@{
    Verdict = 'PASS'
    ArtifactCount = $rows.Count
    ManifestPath = $manifest
    ManifestSha256 = $manifestHash
} | ConvertTo-Json
