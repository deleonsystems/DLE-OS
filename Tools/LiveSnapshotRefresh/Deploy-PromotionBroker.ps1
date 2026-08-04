[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = [Security.Principal.WindowsPrincipal]::new($identity)
if (
    $identity.Name -ine 'DLE-OS-HOST\DLE-OS' -or
    -not $principal.IsInRole(
        [Security.Principal.WindowsBuiltInRole]::Administrator)
) {
    throw 'Promotion broker deployment requires elevated DLE-OS.'
}
$project =
    'C:\DLE-OS\Repositories\DLE-OS\Tools\LiveSnapshotRefresh\PromotionHost\DleOs.LiveSnapshotRefresh.PromotionHost.csproj'
$runtime = 'C:\Program Files\DLE-OS\LiveSnapshotRefreshPromotion'
$logs = 'C:\ProgramData\DLE-OS\LiveSnapshotRefresh\Logs'
$evidence =
    'C:\ProgramData\DLE-OS\LiveSnapshotRefresh\promotion-host-launch-evidence.json'
$url = 'http://localhost:5044/'
New-Item -ItemType Directory -Path $runtime, $logs -Force | Out-Null
& 'C:\Program Files\dotnet\dotnet.exe' publish $project `
    -c Release --output $runtime
if ($LASTEXITCODE -ne 0) {
    throw "Promotion broker publish returned $LASTEXITCODE."
}
$urlAcl = & netsh http show urlacl url=$url 2>$null
if ($LASTEXITCODE -ne 0 -or $urlAcl -notmatch 'DLE-OS-HOST\\DLE-OS') {
    if ($LASTEXITCODE -eq 0) {
        & netsh http delete urlacl url=$url | Out-Null
    }
    & netsh http add urlacl url=$url user='DLE-OS-HOST\DLE-OS' | Out-Null
    if ($LASTEXITCODE -ne 0) {
        throw 'Loopback promotion-broker URL reservation failed.'
    }
}
$existing =
    Get-CimInstance Win32_Process -Filter (
        "Name='DleOs.LiveSnapshotRefresh.PromotionHost.exe'"
    ) -ErrorAction SilentlyContinue
foreach ($process in @($existing)) {
    Stop-Process -Id $process.ProcessId -Force
}
$executable =
    Join-Path $runtime 'DleOs.LiveSnapshotRefresh.PromotionHost.exe'
$process = Start-Process `
    -FilePath $executable `
    -WorkingDirectory $runtime `
    -RedirectStandardOutput (Join-Path $logs 'promotion-host.stdout.log') `
    -RedirectStandardError (Join-Path $logs 'promotion-host.stderr.log') `
    -WindowStyle Hidden `
    -PassThru
[ordered]@{
    LaunchedAtUtc = [DateTimeOffset]::UtcNow.ToString('O')
    ProcessId = $process.Id
    WindowsIdentity = $identity.Name
    Elevated = $true
    Endpoint = 'http://localhost:5044'
    BrowserCorsEnabled = $false
    SourceAccess = 'NONE'
} |
    ConvertTo-Json -Depth 4 |
    Set-Content -LiteralPath $evidence -Encoding UTF8
