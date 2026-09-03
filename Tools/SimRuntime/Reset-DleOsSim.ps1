[CmdletBinding()]
param(
    [string] $ProfilePath,
    [switch] $ConfirmReset,
    [switch] $Json
)

$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot 'Developer\SimDeveloperTools.psm1') -Force
$profile = Get-DleOsSimProfile $ProfilePath
if (-not $ConfirmReset) {
    $confirmation = Read-Host 'Type RESET SIM to reset the local SIM state'
    if ($confirmation -ne 'RESET SIM') {
        throw 'Reset cancelled. The exact confirmation phrase was not entered.'
    }
}
$accessCode = [Environment]::GetEnvironmentVariable(
    'DLE_OS_SIM_PERMANENT_ACCESS_CODE',
    [EnvironmentVariableTarget]::User)
if ([string]::IsNullOrWhiteSpace($accessCode)) {
    throw 'Reset requires DLE_OS_SIM_PERMANENT_ACCESS_CODE in User scope so it can authenticate to the local SIM without printing the secret.'
}
$session = New-Object Microsoft.PowerShell.Commands.WebRequestSession
$login = Invoke-WebRequest -Uri ($profile.url + '/sim-access') `
    -Method Post `
    -Body @{ sim_access = $accessCode.Trim() } `
    -WebSession $session `
    -SkipCertificateCheck `
    -MaximumRedirection 0 `
    -ErrorAction SilentlyContinue
if ([int]$login.StatusCode -notin 200,302) {
    throw 'SIM access-code authentication failed; reset was not attempted.'
}
$requestId = [guid]::NewGuid().ToString()
$body = @{ confirmation = 'RESET SIM'; requestId = $requestId } | ConvertTo-Json
$result = Invoke-RestMethod -Uri ($profile.url + '/api/sim/reset') `
    -Method Post `
    -Body $body `
    -ContentType 'application/json' `
    -WebSession $session `
    -SkipCertificateCheck
if ($Json) { $result | ConvertTo-Json -Depth 10 } else { $result | Format-List }
