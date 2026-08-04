[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$approvedIdentity = 'DLE-OS-HOST\DLE-OS'
$repository = 'C:\DLE-OS\Repositories\DLE-OS'
$project = Join-Path $repository (
    'Tools\DevelopmentRuntime\DleOs.CustomerFilesControl\' +
    'DleOs.CustomerFilesControl.csproj'
)
$runtime = Join-Path $repository (
    'Tools\DevelopmentRuntime\DleOs.CustomerFilesControl\bin\Release\net8.0'
)
$assembly = Join-Path $runtime 'DleOs.CustomerFilesControl.dll'
$dotnet = 'C:\Program Files\dotnet\dotnet.exe'
$logRoot = Join-Path $repository '.tmp\customer-files-001'

$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = [Security.Principal.WindowsPrincipal]::new($identity)
if ($identity.Name -ine $approvedIdentity) {
    throw "Customer Files control requires $approvedIdentity."
}
if ($principal.IsInRole(
    [Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw 'Customer Files control must be started from the normal operator token.'
}
if (
    netstat.exe -ano -p tcp |
        Select-String -Pattern '^\s*TCP\s+\S+:5053\s+\S+\s+LISTENING\s+\d+\s*$'
) {
    throw 'Port 5053 is already listening.'
}

& $dotnet build $project --configuration Release --nologo
if ($LASTEXITCODE -ne 0) {
    throw 'Customer Files control build failed.'
}
New-Item -ItemType Directory -Path $logRoot -Force | Out-Null
$process = Start-Process `
    -FilePath $dotnet `
    -ArgumentList "`"$assembly`"" `
    -WorkingDirectory $runtime `
    -RedirectStandardOutput (Join-Path $logRoot '5053.stdout.log') `
    -RedirectStandardError (Join-Path $logRoot '5053.stderr.log') `
    -WindowStyle Hidden `
    -PassThru

for ($attempt = 0; $attempt -lt 40; $attempt++) {
    try {
        $response = Invoke-WebRequest `
            -UseBasicParsing `
            -UseDefaultCredentials `
            -Uri 'http://dle-os-host:5053/health' `
            -TimeoutSec 2
        if ($response.StatusCode -eq 200) {
            [pscustomobject]@{
                Verdict = 'PASS'
                ProcessId = $process.Id
                Identity = $identity.Name
                Endpoint = 'http://dle-os-host:5053'
            }
            exit 0
        }
    } catch {
        if ($process.HasExited) {
            throw (
                'Customer Files control exited during startup. See ' +
                (Join-Path $logRoot '5053.stderr.log')
            )
        }
    }
    Start-Sleep -Milliseconds 250
}
throw 'Customer Files control did not become ready within 10 seconds.'
