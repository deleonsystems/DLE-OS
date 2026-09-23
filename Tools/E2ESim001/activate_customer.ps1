param([switch] $ValidateOnly)
$ErrorActionPreference = 'Stop'
$repo = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$evidence = Join-Path $repo 'output/pdf/E2E-SIM-001/runtime-validation.json'
$profile = Get-Content (Join-Path $env:LOCALAPPDATA 'DLE-OS/SIM/sim-profile.json') -Raw | ConvertFrom-Json
if ([IO.Path]::GetFullPath($profile.repoPath) -ne $repo) { throw 'SIM profile points at another repository.' }
function Fingerprint {
    $values = @{}
    foreach ($directory in @('data','state','intake-documents')) {
        $root = Join-Path $repo ".sim-state/$directory"
        if (Test-Path $root) {
            Get-ChildItem -LiteralPath $root -Recurse -File | ForEach-Object {
                $values[[IO.Path]::GetRelativePath($repo,$_.FullName)] = (Get-FileHash -LiteralPath $_.FullName).Hash
            }
        }
    }
    return $values
}
function Session {
    $session = [Microsoft.PowerShell.Commands.WebRequestSession]::new()
    $code = [Environment]::GetEnvironmentVariable('DLE_OS_SIM_PERMANENT_ACCESS_CODE','User')
    if ([string]::IsNullOrWhiteSpace($code)) { throw 'Configured SIM access unavailable.' }
    $null = Invoke-WebRequest -Uri ($profile.url + '/sim-access') -Method Post -Body @{sim_access=$code} -WebSession $session -TimeoutSec 10
    return $session
}
$session = Session
$beforeStatus = Invoke-RestMethod ($profile.url + '/api/sim/status') -WebSession $session
if ($beforeStatus.environment -ne 'SIM' -or $beforeStatus.status -ne 'READY') { throw 'SIM is not ready.' }
if ($ValidateOnly) {
    $before = Get-Content (Join-Path $repo 'output/pdf/E2E-SIM-001/business-state-before.json') -Raw | ConvertFrom-Json -AsHashtable
} else {
    $before = Fingerprint
    $before | ConvertTo-Json -Depth 5 | Set-Content (Join-Path $repo 'output/pdf/E2E-SIM-001/business-state-before.json')
    & (Join-Path $repo 'Tools/SimRuntime/Stop-DleOsSim.ps1') -Json
    & (Join-Path $repo 'Tools/SimRuntime/DesktopControls/Start-DleOsSimServer.ps1')
    if ($LASTEXITCODE -ne 0) { throw 'SIM start failed.' }
}
$session = Session
$status = Invoke-RestMethod ($profile.url + '/api/sim/status') -WebSession $session
$results = @()
foreach ($query in @('DLE-SIM-CUSTOMER','990901','SIM-CUSTOMER-E2E-001','Abbott')) {
    $result = Invoke-RestMethod ($profile.url + '/api/platform/live/v1/customer-directory/search?q=' + $query) -WebSession $session
    if ($result.returnedCount -ne 1 -or !$result.items[0].synthetic -or $result.environment -ne 'SIM') { throw "Directory check failed: $query" }
    if ($query -ne 'Abbott' -and $result.items[0].customerId -ne 'SIM-CUSTOMER-E2E-001') { throw 'Wrong synthetic identity.' }
    $results += @{query=$query; customer=$result.items[0]}
}
$after = Fingerprint
if ($before.Count -ne $after.Count) { throw 'Business file inventory changed.' }
foreach ($key in $before.Keys) { if ($before[$key] -ne $after[$key]) { throw "Business data changed: $key" } }
@{result='PASS'; status=$status; previousStatus=$beforeStatus; directory=$results; businessFilesUnchanged=$before.Count; noIntakeSubmitted=$true; validatedAtUtc=[DateTimeOffset]::UtcNow.ToString('O')} | ConvertTo-Json -Depth 10 | Set-Content $evidence
Write-Output "PASS: SIM customer searchable; Abbott preserved; $($before.Count) business files unchanged. Evidence: $evidence"
