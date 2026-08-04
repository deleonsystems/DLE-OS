[CmdletBinding()]
param(
    [string] $ArtifactRoot = (
        'C:\DLE-OS\Repositories\DLE-OS\Artifacts\' +
        'SupportingCodeTablesPlatform001\' +
        'SUPPORTINGCODETABLESPLATFORM001-20260730T133739Z')
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$manifestPath = Join-Path $ArtifactRoot 'ARTIFACT_MANIFEST.csv'
$hashPath = Join-Path $ArtifactRoot 'ARTIFACT_MANIFEST.sha256'
$excludedDirectories = @(
    'BaselinePackage-PreCountFix',
    'ServerBuildQualification',
    'ServerBuildQualification-Final'
)
$rows = Get-ChildItem -LiteralPath $ArtifactRoot -File -Recurse |
    Where-Object {
        $relative = $_.FullName.Substring(
            $ArtifactRoot.TrimEnd('\').Length + 1)
        $excluded = @($excludedDirectories | Where-Object {
            $relative.StartsWith(
                $_ + [IO.Path]::DirectorySeparatorChar,
                [StringComparison]::OrdinalIgnoreCase)
        }).Count -gt 0
        $_.FullName -ne $manifestPath -and
        $_.FullName -ne $hashPath -and
        -not $excluded
    } |
    Sort-Object FullName |
    ForEach-Object {
        [pscustomobject]@{
            RelativePath = $_.FullName.Substring(
                $ArtifactRoot.TrimEnd('\').Length + 1)
            SizeBytes = $_.Length
            Sha256 = (Get-FileHash -LiteralPath $_.FullName `
                -Algorithm SHA256).Hash
        }
    }
$rows | Export-Csv -LiteralPath $manifestPath -NoTypeInformation `
    -Encoding UTF8
$manifestHash = (Get-FileHash -LiteralPath $manifestPath `
    -Algorithm SHA256).Hash
"$manifestHash  ARTIFACT_MANIFEST.csv" |
    Set-Content -LiteralPath $hashPath -Encoding ASCII
[ordered]@{
    Verdict = 'PASS'
    ArtifactCount = @($rows).Count
    ManifestPath = $manifestPath
    ManifestSha256 = $manifestHash
} | ConvertTo-Json -Depth 4
