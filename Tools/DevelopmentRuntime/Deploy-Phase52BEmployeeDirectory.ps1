[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = [Security.Principal.WindowsPrincipal]::new($identity)
if ($identity.Name -ine 'DLE-OS-HOST\Miguel' -or
    -not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw 'Phase 5.2B development deployment requires elevated DLE-OS-HOST\Miguel.'
}

$repository = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$frontendProject = Join-Path $repository 'Tools\DevelopmentRuntime\DleOs.DevelopmentFrontend\DleOs.DevelopmentFrontend.csproj'
$frontendTask = 'DLE-OS Development Authenticated Frontend 5051'
$launcher = Join-Path $repository 'Tools\DevelopmentRuntime\Launch-DevelopmentFrontendService.ps1'
$evidencePath = Join-Path $repository '.tmp\employee-directory\phase52b-deployment.json'
$protectedPorts = 5041,5042,5043,5052,5053

function Get-ListenerPid([int]$Port) {
    $line = netstat.exe -ano -p tcp | Select-String -Pattern (':' + $Port + '\s+.*LISTENING\s+\d+$') |
        Select-Object -First 1
    if (-not $line) { return $null }
    return [int]((-split $line.Line)[-1])
}
function Get-ProtectedSnapshot {
    $result = [ordered]@{}
    foreach ($port in $protectedPorts) { $result[[string]$port] = Get-ListenerPid $port }
    return $result
}
function Get-FrontendWorkers {
    return @(Get-CimInstance Win32_Process -Filter "Name='dotnet.exe'" | Where-Object {
        -not [string]::IsNullOrWhiteSpace($_.CommandLine) -and
        $_.CommandLine.IndexOf('DleOs.DevelopmentFrontend.dll',[StringComparison]::OrdinalIgnoreCase) -ge 0
    })
}
function Wait-5051([bool]$Present,[int]$Seconds=45) {
    $deadline=[DateTimeOffset]::UtcNow.AddSeconds($Seconds)
    do {
        Start-Sleep -Milliseconds 250
        if (($null -ne (Get-ListenerPid 5051)) -eq $Present) { return }
    } while([DateTimeOffset]::UtcNow -lt $deadline)
    throw "Development port 5051 did not reach Present=$Present."
}

$before=Get-ProtectedSnapshot
$workers=@(Get-FrontendWorkers)
$evidence=[ordered]@{
    Verdict='FAIL';StartedAtUtc=[DateTimeOffset]::UtcNow.ToString('O')
    Identity=$identity.Name;ProtectedBefore=$before
}
try {
    if ($workers.Count -ne 1 -or (Get-ListenerPid 5051) -ne 4) {
        throw 'The existing authenticated 5051 worker could not be identified uniquely.'
    }
    $evidence.FrontendWorkerBefore=[int]$workers[0].ProcessId
    Stop-Process -Id $workers[0].ProcessId -Force
    Wait-5051 $false

    dotnet.exe build $frontendProject -c Release --nologo --no-restore
    if ($LASTEXITCODE -ne 0) { throw 'Phase 5.2B frontend Release build failed.' }

    & $launcher | Out-Null
    Wait-5051 $true
    $workersAfter=@(Get-FrontendWorkers)
    if ($workersAfter.Count -ne 1) { throw 'The updated authenticated 5051 worker is not unique.' }
    $evidence.FrontendWorkerAfter=[int]$workersAfter[0].ProcessId

    $directory=Invoke-RestMethod -UseDefaultCredentials -TimeoutSec 20 `
        -Uri 'http://dle-os-host:5051/api/development/employees/v1/directory?includeHistorical=true'
    if ($directory.totalEmployees -ne 11 -or @($directory.items).Count -ne 11) {
        throw 'The updated 5051 Employee Directory did not return 11 employees.'
    }
    $evidence.EmployeeDirectory=[ordered]@{
        TotalEmployees=$directory.totalEmployees
        CurrentEmployees=$directory.currentEmployees
        HistoricalRetainedEmployees=$directory.historicalRetainedEmployees
        LinkedUsers=$directory.linkedUsers
        UnprovisionedEmployees=$directory.unprovisionedEmployees
    }

    $after=Get-ProtectedSnapshot
    $evidence.ProtectedAfter=$after
    if (($before|ConvertTo-Json -Compress) -ne ($after|ConvertTo-Json -Compress)) {
        throw 'A protected production listener changed during Phase 5.2B deployment.'
    }
    $evidence.Verdict='PASS'
}
catch {
    $evidence.Error=$_.Exception.Message
    if ($null -eq (Get-ListenerPid 5051)) {
        try { Start-ScheduledTask -TaskName $frontendTask; Wait-5051 $true } catch {}
    }
    throw
}
finally {
    $evidence.CompletedAtUtc=[DateTimeOffset]::UtcNow.ToString('O')
    New-Item -ItemType Directory -Path (Split-Path $evidencePath -Parent) -Force|Out-Null
    $evidence|ConvertTo-Json -Depth 10|Set-Content -LiteralPath $evidencePath -Encoding utf8
}
[pscustomobject]$evidence
