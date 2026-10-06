param([string] $SourceRoot, [string] $FixtureRoot = [IO.Path]::GetTempPath())
$ErrorActionPreference='Stop'
if (-not $SourceRoot) { $SourceRoot=Join-Path $PSScriptRoot '..\..\Tools\SimRuntime' }
$flat=Test-Path -LiteralPath (Join-Path $SourceRoot 'SimDeveloperTools.psm1')
$modulePath=if($flat){Join-Path $SourceRoot 'SimDeveloperTools.psm1'}else{Join-Path $SourceRoot 'Developer\SimDeveloperTools.psm1'}
$startPath=if($flat){Join-Path $SourceRoot 'Start-DleOsSimServer.ps1'}else{Join-Path $SourceRoot 'DesktopControls\Start-DleOsSimServer.ps1'}
$fixture=Join-Path $FixtureRoot ('sim-entry-tests-'+[guid]::NewGuid())
New-Item -ItemType Directory -Path "$fixture\.sim-state\runtime" -Force | Out-Null
function Assert($Condition,[string]$Name) {if(-not $Condition){throw "FAIL: $Name"}; Write-Output "PASS: $Name"}
$profile=[pscustomobject]@{repoPath=$fixture;url='https://fixture.invalid:5177';hostname='fixture.invalid';lanIp='192.168.1.2'}
$metadata=@{environment='SIM';networkBoundary='PRIVATE_LAN_HTTPS';binding=$profile.url;lanHostName=$profile.hostname;processId=123;startedAtUtc='2026-10-01T01:00:00Z'}
$metadata | ConvertTo-Json | Set-Content "$fixture\.sim-state\runtime\runtime.json"
$m=Import-Module $modulePath -Force -PassThru
& $m {
    $script:testListener=[pscustomobject]@{owningProcess=123;localAddress='192.168.1.2'}
    $script:testProcess=$null
    function script:Get-DleOsSimTcpListener {param($LocalAddress,$Port) $script:testListener}
    function script:Get-Process {param($Id,$ErrorAction) $script:testProcess}
}
$fake=[pscustomobject]@{Path=(Join-Path $fixture 'Tools\SimRuntime\DleOs.SimHost\bin\Debug\net8.0\DleOs.SimHost.exe');StartTime=[datetime]'2026-10-01T00:59:59Z';ProcessName='DleOs.SimHost'}
& $m {param($p) $script:testProcess=$p} $fake
Assert (Get-DleOsSimRuntimeStatus $profile).running 'matching path, PID, listener and creation time accepted'
& $m {$script:testListener.owningProcess=999}
Assert (-not (Get-DleOsSimRuntimeStatus $profile).running) 'unrelated listener PID rejected'
& $m {$script:testListener.owningProcess=123;$script:testProcess.StartTime=[datetime]'2026-10-01T02:00:00Z'}
Assert (-not (Get-DleOsSimRuntimeStatus $profile).running) 'recycled PID rejected'
& $m {$script:testProcess.StartTime=[datetime]'2026-10-01T00:59:59Z';$script:testProcess.Path='C:\unrelated.exe'}
Assert (-not (Get-DleOsSimRuntimeStatus $profile).running) 'unrelated executable rejected'
& $m {$script:testListener=$null}
Assert (-not (Get-DleOsSimRuntimeStatus $profile).running) 'stale metadata without listener rejected'
& $m {
    $script:dnsCalls=0
    function script:Resolve-DnsName {param($Name,$Type,$ErrorAction) $script:dnsCalls++; if($script:dnsCalls -lt 3){throw 'DNS name does not exist.'}; [pscustomobject]@{Type='A';IPAddress='192.168.1.2'}}
    function script:Start-Sleep {param($Milliseconds)}
}
$dns=Test-DleOsSimDns $profile
Assert ($dns.passed -and $dns.attempts.Count -eq 3 -and $dns.attempts[0].error) 'DNS transient failures retry and retain evidence'
& $m {function script:Resolve-DnsName {param($Name,$Type,$ErrorAction) [pscustomobject]@{Type='A';IPAddress='192.168.1.99'}}}
$dns=Test-DleOsSimDns $profile
Assert (-not $dns.passed -and $dns.attempts.Count -eq 3) 'wrong DNS address fails after bounded attempts'
$profile | Add-Member -NotePropertyName certificateThumbprint -NotePropertyValue 'fixture' -Force
$profileFile=Join-Path $fixture 'sim-profile.json'
$profile | ConvertTo-Json | Set-Content -LiteralPath $profileFile
& $m {
    $script:testListener=[pscustomobject]@{owningProcess=999;localAddress='192.168.1.2'}
    $script:testStopped=$false
    function script:Stop-Process {param($Id,$Force) $script:testStopped=$true}
}
$refused=$false
try {Stop-DleOsSimSafely -ProfilePath $profileFile | Out-Null}catch{$refused=$_.Exception.Message -match 'not verified'}
Assert ($refused -and -not (& $m {$script:testStopped})) 'Stop refuses an unrelated listener without terminating anything'
& $m {$script:testListener=$null}
$stopResult=Stop-DleOsSimSafely -ProfilePath $profileFile
Assert ($stopResult.result -eq 'stopped' -and -not (& $m {$script:testStopped})) 'Stop never kills a stale metadata PID without a verified listener'
Remove-Module $m
$oldLocal=$env:LOCALAPPDATA
try {
    foreach($case in 'malformed-profile','missing-module') {
        $env:LOCALAPPDATA=Join-Path $fixture $case
        $base=Join-Path $env:LOCALAPPDATA 'DLE-OS\SIM'
        New-Item -ItemType Directory -Path $base -Force | Out-Null
        if($case -eq 'malformed-profile') {'{broken' | Set-Content "$base\sim-profile.json"}else{@{repoPath=$fixture} | ConvertTo-Json | Set-Content "$base\sim-profile.json"}
        & (Join-Path $PSHOME 'pwsh.exe') -NoProfile -File $startPath -NoPopup -SimHome $base
        $rc=$LASTEXITCODE
        $status=Get-Content "$base\start-status.json" -Raw | ConvertFrom-Json
        Assert ($rc -eq 1 -and $status.result -eq 'failed' -and $status.reason -and $status.errorId) "$case retains cause and failure code"
        Assert (@(Get-ChildItem "$base\Logs\start-*.json").Count -eq 1) "$case retains per-attempt evidence"
        $handle=[IO.File]::Open("$base\start.lock",'Open','ReadWrite','None')
        $handle.Dispose()
        Assert $true "$case releases startup lock"
    }
} finally {$env:LOCALAPPDATA=$oldLocal}
$t=$null;$e=$null
$ast=[Management.Automation.Language.Parser]::ParseFile($startPath,[ref]$t,[ref]$e)
foreach($name in 'Protect-ErrorText','Test-AuthenticatedReady','Test-PendingRunnerIdentity') {
    $fn=$ast.Find({param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq $name},$true)
    Invoke-Expression $fn.Extent.Text
}
$record=[pscustomobject]@{processStartedAtUtc='2026-10-01T01:00:00Z'}
$pendingFake=[pscustomobject]@{Path='C:\Program Files\PowerShell\7\pwsh.exe';StartTime=([datetime]'2026-10-01T01:00:00Z')}
Assert (Test-PendingRunnerIdentity $record $pendingFake) 'unfinished runner identity recognized'
$pendingFake.StartTime=[datetime]'2026-10-01T02:00:00Z'
Assert (-not (Test-PendingRunnerIdentity $record $pendingFake)) 'recycled pending runner PID rejected'
$usesUserConfiguredCode=$true;$configuredAccessCode='test-secret';$script:calls=0
function Invoke-WebRequest {param($Uri,$Method,$Body,$WebSession,$TimeoutSec) $script:calls++;if($script:calls -lt 3){throw 'simulated TLS error test-secret'}}
function Invoke-RestMethod {param($Uri,$WebSession,$TimeoutSec) @{status='READY';environment=$script:testEnvironment;networkBoundary='PRIVATE_LAN_HTTPS';binding=$profile.url}}
function Start-Sleep {param($Milliseconds)}
$script:testEnvironment='SIM'
Assert (Test-AuthenticatedReady -Attempts 3) 'transient readiness error recovers'
$script:testEnvironment='DEV'
Assert (-not (Test-AuthenticatedReady)) 'wrong environment rejected'
function Invoke-WebRequest {throw 'simulated TLS error test-secret'}
Assert (-not (Test-AuthenticatedReady)) 'TLS failure fails closed'
Assert ($lastReadinessError -match 'simulated TLS error' -and $lastReadinessError -notmatch 'test-secret') 'underlying error retained with credential redacted'
$usesUserConfiguredCode=$false
Assert (-not (Test-AuthenticatedReady)) 'missing authentication rejected'
$runnerFixture=Join-Path $fixture 'runner'
New-Item -ItemType Directory -Path "$runnerFixture\Developer" -Force | Out-Null
$runnerSource=Join-Path $SourceRoot 'Start-DleOsSimDeveloper.ps1'
Copy-Item -LiteralPath $runnerSource -Destination "$runnerFixture\Start-DleOsSimDeveloper.ps1"
$stub=@(
'function Get-DleOsSimProfile {param($Path) [pscustomobject]@{repoPath=$PSScriptRoot;url="https://fixture.invalid"}}',
'function Get-DleOsSimRuntimeStatus {param($Profile) [pscustomobject]@{running=$false}}',
'function Test-DleOsSimPreflight {param($Path) [pscustomobject]@{passed=$false;checks=@([pscustomobject]@{name="dns";passed=$false;message="fixture resolver NXDOMAIN"})}}',
'Export-ModuleMember -Function *'
)
$stub | Set-Content "$runnerFixture\Developer\SimDeveloperTools.psm1"
$errPath=Join-Path $runnerFixture 'stderr.txt'
& (Join-Path $PSHOME 'pwsh.exe') -NoProfile -File "$runnerFixture\Start-DleOsSimDeveloper.ps1" -LifecyclePath "$runnerFixture\lifecycle.jsonl" 2> $errPath
$rc=$LASTEXITCODE
Assert ($rc -eq 1 -and (Get-Content $errPath -Raw) -match 'resolver NXDOMAIN') 'runner preserves underlying preflight failure'
$events=@(Get-Content "$runnerFixture\lifecycle.jsonl" | ForEach-Object {$_ | ConvertFrom-Json})
Assert ('runner-error' -in $events.event -and 'runner-exit' -in $events.event -and 'preflight' -in $events.event) 'runner records preflight and failure lifecycle'
'All isolated tests passed; no application endpoint contacted.'
