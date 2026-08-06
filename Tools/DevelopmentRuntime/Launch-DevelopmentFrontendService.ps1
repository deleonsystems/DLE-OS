[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$repository = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')).Path
$taskName = 'DLE-OS Development Authenticated Frontend 5051'
$serviceIdentity = 'DLE-OS-HOST\DLE-OS'
$startScript = Join-Path $repository 'Tools\DevelopmentRuntime\Start-DevelopmentFrontend.ps1'
$evidencePath = Join-Path $repository '.tmp\development-runtime\5051-compatibility-launch.json'
$protectedPorts = 5041,5042,5043,5052,5053

$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = [Security.Principal.WindowsPrincipal]::new($identity)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw 'The development frontend service launcher requires an elevated Administrator token.'
}

function Get-ListenerPid([int] $Port) {
    $line = netstat.exe -ano -p tcp |
        Select-String -Pattern (':' + $Port + '\s+.*LISTENING\s+\d+$') |
        Select-Object -First 1
    if (-not $line) { return $null }
    return [int]((-split $line.Line)[-1])
}

function Get-ProtectedSnapshot {
    $result = [ordered]@{}
    foreach ($port in $protectedPorts) { $result[[string]$port] = Get-ListenerPid $port }
    return $result
}

$before = Get-ProtectedSnapshot
$evidence = [ordered]@{
    Verdict = 'FAIL'
    StartedAtUtc = [DateTimeOffset]::UtcNow.ToString('O')
    LauncherIdentity = $identity.Name
    ServiceIdentity = $serviceIdentity
    ScheduledTask = $taskName
    ProtectedBefore = $before
}

try {
    if (Get-ListenerPid 5051) { throw 'Port 5051 must be prepared and released before service launch.' }

    $action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument (
        '-NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "' + $startScript + '"')
    $taskPrincipal = New-ScheduledTaskPrincipal -UserId $serviceIdentity `
        -LogonType Interactive -RunLevel Highest
    $settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit (New-TimeSpan -Minutes 5) `
        -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
    Register-ScheduledTask -TaskName $taskName -Action $action -Principal $taskPrincipal `
        -Settings $settings -Force | Out-Null
    Start-ScheduledTask -TaskName $taskName

    $deadline = [DateTimeOffset]::UtcNow.AddSeconds(45)
    do {
        Start-Sleep -Milliseconds 250
        $listener = Get-ListenerPid 5051
    } while ($listener -ne 4 -and [DateTimeOffset]::UtcNow -lt $deadline)
    if ($listener -ne 4) {
        $task = Get-ScheduledTaskInfo -TaskName $taskName
        throw "The DLE-OS service worker did not bind 5051. Task result: $($task.LastTaskResult)."
    }

    $worker = Get-CimInstance Win32_Process -Filter "Name='dotnet.exe'" |
        Where-Object { $_.CommandLine -like '*DleOs.DevelopmentFrontend.dll*' } |
        Select-Object -First 1
    if (-not $worker) { throw 'The authenticated frontend worker could not be identified.' }
    $owner = Invoke-CimMethod -InputObject $worker -MethodName GetOwner
    $ownerName = $owner.Domain + '\' + $owner.User
    if ($ownerName -ine $serviceIdentity) {
        throw "The authenticated frontend worker runs as unexpected identity $ownerName."
    }

    $me = Invoke-RestMethod -UseDefaultCredentials `
        -Uri 'http://dle-os-host:5051/api/auth/me' -TimeoutSec 20
    if ($me.user.userName -ne 'Miguel' -or $me.user.displayName -ne 'Miguel De Leon' -or
        $me.user.accountStatus -ne 'ACTIVE' -or -not $me.isSuperAdmin -or
        @($me.roles) -notcontains 'SUPER_ADMIN') {
        throw 'Miguel did not resolve through the service-hosted authenticated frontend.'
    }

    $after = Get-ProtectedSnapshot
    $evidence.ProtectedAfter = $after
    if (($before | ConvertTo-Json -Compress) -ne ($after | ConvertTo-Json -Compress)) {
        throw 'A protected listener changed during service-hosted frontend launch.'
    }
    $evidence.ProcessId = [int]$worker.ProcessId
    $evidence.HttpSysListenerPid = 4
    $evidence.CurrentUser = $me
    $evidence.Verdict = 'PASS'
}
catch {
    $evidence.Error = $_.Exception.Message
    throw
}
finally {
    $evidence.CompletedAtUtc = [DateTimeOffset]::UtcNow.ToString('O')
    New-Item -ItemType Directory -Path (Split-Path $evidencePath -Parent) -Force | Out-Null
    $evidence | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath $evidencePath -Encoding utf8
}

[pscustomobject]$evidence
