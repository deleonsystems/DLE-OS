[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
$source = Join-Path $PSScriptRoot 'DesktopControls'
$destination = Join-Path $env:LOCALAPPDATA 'DLE-OS\SIM\Controls'
if (-not (Test-Path (Join-Path (Split-Path $destination) 'sim-profile.json'))) {
    throw 'Configure the user SIM profile before installing Desktop controls.'
}
New-Item -ItemType Directory -Path $destination -Force | Out-Null
$backup = Join-Path $destination ('backup-' + (Get-Date -Format 'yyyyMMdd-HHmmss-fff'))
New-Item -ItemType Directory -Path $backup | Out-Null
$manifest = foreach ($name in 'Start-DleOsSimServer.ps1','Stop-DleOsSimServer.ps1') {
    $target = Join-Path $destination $name
    if (Test-Path $target) { Copy-Item -LiteralPath $target -Destination $backup }
    Copy-Item -LiteralPath (Join-Path $source $name) -Destination $target -Force
    [pscustomobject]@{ name = $name; sha256 = (Get-FileHash $target).Hash }
}
@{
    installedAtUtc = [DateTimeOffset]::UtcNow.ToString('O')
    source = $source
    files = @($manifest)
} | ConvertTo-Json -Depth 4 | Set-Content (Join-Path $destination 'installation.json')
$manifest
