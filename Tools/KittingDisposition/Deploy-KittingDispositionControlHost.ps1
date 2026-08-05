[CmdletBinding()]
param(
    [Parameter(Mandatory)][string] $ArtifactRoot,
    [switch] $ElevatedStage
)
$ErrorActionPreference='Stop'; Set-StrictMode -Version Latest
$repository='C:\DLE-OS\Repositories\DLE-OS'
$project=Join-Path $repository 'Tools\LiveSnapshotRefresh\ControlHost\DleOs.LiveSnapshotRefresh.ControlHost.csproj'
$runtime='C:\Program Files\DLE-OS\LiveSnapshotRefreshControl'
$runtimeExe=Join-Path $runtime 'DleOs.LiveSnapshotRefresh.ControlHost.exe'
$launcher=Join-Path $repository 'Tools\LiveSnapshotRefresh\Start-ElevatedRefreshControlHost.ps1'
$artifact=[IO.Path]::GetFullPath($ArtifactRoot)
$approvedRoot=[IO.Path]::GetFullPath((Join-Path $repository 'Artifacts\Kitting001C1Runtime'))
if(-not $artifact.StartsWith($approvedRoot+'\',[StringComparison]::OrdinalIgnoreCase)){throw 'Artifact root is outside KITTING-001C1.'}
$identity=[Security.Principal.WindowsIdentity]::GetCurrent()
$isAdmin=[Security.Principal.WindowsPrincipal]::new($identity).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if(-not $ElevatedStage){
    if($isAdmin){throw 'Preparation must begin under the normal operator token.'}
    $args=@('-NoProfile','-ExecutionPolicy','Bypass','-File',"`"$PSCommandPath`"",'-ArtifactRoot',"`"$artifact`"",'-ElevatedStage')
    $child=Start-Process powershell.exe -ArgumentList $args -Verb RunAs -Wait -PassThru
    $evidence=Join-Path $artifact '5043-deployment.json'
    if($child.ExitCode -ne 0 -or -not(Test-Path $evidence)){throw 'The UAC-elevated 5043 deployment failed.'}
    $result=Get-Content $evidence -Raw|ConvertFrom-Json
    if($result.Verdict -ne 'PASS'){throw "The elevated deployment verdict was $($result.Verdict)."}
    $result|ConvertTo-Json -Depth 10
    exit 0
}
if(-not $isAdmin){throw 'The elevated deployment stage requires administrator rights.'}
$backup=Join-Path $artifact 'PreDeploy5043\LiveSnapshotRefreshControl'
if(-not (Test-Path $backup -PathType Container)){throw 'The pre-deployment rollback package is absent.'}

function Get-ListenerPid([int]$port){$row=netstat.exe -ano -p tcp|Select-String ('^\s*TCP\s+\S+:'+$port+'\s+\S+\s+LISTENING\s+\d+\s*$')|Select-Object -First 1;if($row){[int]((-split $row.Line)[-1])}}
function Get-ControlProcess {@(Get-Process -Name 'DleOs.LiveSnapshotRefresh.ControlHost' -ErrorAction SilentlyContinue)}
function Http([string]$path){$r=Invoke-WebRequest -UseBasicParsing -UseDefaultCredentials -Uri ('http://DLE-OS-HOST:5043'+$path) -TimeoutSec 20;[ordered]@{Path=$path;Status=[int]$r.StatusCode;Body=$r.Content}}
function Wait-Control {$deadline=[DateTimeOffset]::UtcNow.AddSeconds(45);do{$p=@(Get-ControlProcess);if($p.Count -eq 1 -and (Get-ListenerPid 5043)){return $p[0]};Start-Sleep -Milliseconds 250}while([DateTimeOffset]::UtcNow -lt $deadline);throw '5043 did not become ready.'}

$protected=[ordered]@{};foreach($port in 5041,5042,5051,5052){$protected[[string]$port]=Get-ListenerPid $port}
$old=@(Get-ControlProcess);if($old.Count -ne 1){throw "Expected one Control Host process; found $($old.Count)."}
$stage=Join-Path $artifact 'Stage5043';New-Item -ItemType Directory -Path $stage -Force|Out-Null
& 'C:\Program Files\dotnet\dotnet.exe' publish $project -c Release --output $stage --nologo
if($LASTEXITCODE -ne 0){throw 'Control Host publish failed.'}
$result=[ordered]@{Verdict='FAIL';StartedAtUtc=[DateTimeOffset]::UtcNow.ToString('O');Identity=$identity.Name;OldPid=$old[0].Id;OldExeHash=(Get-FileHash $runtimeExe -Algorithm SHA256).Hash;Backup=$backup;Stage=$stage;ProtectedBefore=$protected}
try{
    Stop-Process -Id $old[0].Id -Force;$old[0].WaitForExit(15000)
    Copy-Item -Path (Join-Path $stage '*') -Destination $runtime -Recurse -Force
    & $launcher|Out-Null
    $new=Wait-Control
    $checks=@(Http '/health';Http '/api/platform/refresh/v1/status';Http '/api/work-order-approvals/v1/sales-order-lines/001082/0012067/040';Http '/api/kitting-dispositions/v1/work-orders/0115586';Http '/api/kitting-dispositions/v1/work-orders/0115586/history')
    $after=[ordered]@{};foreach($port in 5041,5042,5051,5052){$after[[string]$port]=Get-ListenerPid $port;if([int]$after[[string]$port]-ne[int]$protected[[string]$port]){throw "Protected listener $port changed."}}
    $result.NewPid=$new.Id;$result.NewExeHash=(Get-FileHash $runtimeExe -Algorithm SHA256).Hash;$result.NewDllHash=(Get-FileHash (Join-Path $runtime 'DleOs.LiveSnapshotRefresh.ControlHost.dll') -Algorithm SHA256).Hash;$result.ProtectedAfter=$after;$result.HttpChecks=$checks;$result.Verdict='PASS'
}catch{
    $result.Error=$_.Exception.Message
    foreach($p in (Get-ControlProcess)){Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue}
    Copy-Item -Path (Join-Path $backup '*') -Destination $runtime -Recurse -Force
    try{& $launcher|Out-Null;$rollback=Wait-Control;$result.RollbackVerdict='PASS';$result.RollbackPid=$rollback.Id}catch{$result.RollbackVerdict='FAIL';$result.RollbackError=$_.Exception.Message}
}finally{$result|ConvertTo-Json -Depth 10|Set-Content (Join-Path $artifact '5043-deployment.json') -Encoding UTF8}
if($result.Verdict -ne 'PASS'){throw "5043 deployment failed: $($result.Error)"}
$result|ConvertTo-Json -Depth 10
