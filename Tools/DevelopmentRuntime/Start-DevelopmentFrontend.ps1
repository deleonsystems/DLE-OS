[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$repository = (Resolve-Path -LiteralPath (
    Join-Path $PSScriptRoot '..\..')).Path
$projectDirectory = Join-Path $repository (
    'Tools\DevelopmentRuntime\DleOs.DevelopmentFrontend')
$project = Join-Path $projectDirectory 'DleOs.DevelopmentFrontend.csproj'
$runtime = Join-Path $projectDirectory 'bin\Release\net8.0'
$assembly = Join-Path $runtime 'DleOs.DevelopmentFrontend.dll'
$runtimeSettings = Join-Path $runtime 'appsettings.json'
$dotnetCommand = Get-Command dotnet.exe -ErrorAction Stop
$dotnet = $dotnetCommand.Source
$binding = 'http://0.0.0.0:5051'
$healthUri = 'http://localhost:5051/'
$evidenceDirectory = Join-Path $repository '.tmp\development-runtime'
$evidencePath = Join-Path $evidenceDirectory '5051-launch.json'
$startupLogPath = Join-Path $evidenceDirectory '5051-startup.log'
$developmentIndicator = 'DEVELOPMENT ' + [char]0x2014 + ' READ ONLY'

if (-not (Test-Path -LiteralPath $project -PathType Leaf)) {
    throw "Development Frontend project is absent: $project"
}

function Get-ListenerProcessIds {
    param([int] $Port)

    $rows = netstat.exe -ano -p tcp |
        Select-String -Pattern (
            '^\s*TCP\s+\S+:' + $Port +
            '\s+\S+\s+LISTENING\s+\d+\s*$')
    return @(
        $rows |
            ForEach-Object { [int]((-split $_.Line)[-1]) } |
            Sort-Object -Unique
    )
}

function Get-ProcessRecord {
    param([int] $ProcessId)

    return Get-CimInstance Win32_Process `
        -Filter "ProcessId=$ProcessId" `
        -ErrorAction Stop
}

function Test-ApprovedFrontendProcess {
    param($ProcessRecord)

    if ($null -eq $ProcessRecord) { return $false }
    if ($ProcessRecord.Name -ine 'dotnet.exe') { return $false }
    if ([string]::IsNullOrWhiteSpace($ProcessRecord.CommandLine)) {
        return $false
    }
    return $ProcessRecord.CommandLine.IndexOf(
        $assembly,
        [StringComparison]::OrdinalIgnoreCase) -ge 0
}

function Test-FrontendHealth {
    $lastError = $null
    for ($attempt = 0; $attempt -lt 12; $attempt++) {
        try {
            $response = Invoke-WebRequest `
                -Uri $healthUri `
                -UseBasicParsing `
                -TimeoutSec 10
            $cacheControl = [string]$response.Headers['Cache-Control']
            $pragma = [string]$response.Headers['Pragma']
            $response.RawContentStream.Position = 0
            $reader = [IO.StreamReader]::new(
                $response.RawContentStream,
                [Text.Encoding]::UTF8,
                $true,
                4096,
                $true)
            try {
                $content = $reader.ReadToEnd()
            }
            finally {
                $reader.Dispose()
            }
            if ($response.StatusCode -ne 200) {
                throw "Unexpected HTTP status $($response.StatusCode)."
            }
            if ($cacheControl -notmatch 'no-store') {
                throw 'The response is missing the no-store cache directive.'
            }
            if ($pragma -notmatch 'no-cache') {
                throw 'The response is missing the no-cache pragma.'
            }
            if (-not $content.Contains($developmentIndicator)) {
                throw 'The development read-only indicator is absent.'
            }
            return [ordered]@{
                StatusCode = [int]$response.StatusCode
                CacheControl = $cacheControl
                Pragma = $pragma
                Expires = [string]$response.Headers['Expires']
                DevelopmentIndicator = $developmentIndicator
            }
        }
        catch {
            $lastError = $_.Exception.Message
            Write-StartupLog (
                "Health attempt $($attempt + 1) failed: $lastError")
            Start-Sleep -Milliseconds 250
        }
    }
    throw "Development Frontend health check failed: $lastError"
}

New-Item -ItemType Directory -Path $evidenceDirectory -Force | Out-Null
Set-Content `
    -LiteralPath $startupLogPath `
    -Value ("{0} Launcher started." -f [DateTimeOffset]::UtcNow.ToString('O')) `
    -Encoding utf8

function Write-StartupLog {
    param([string] $Message)

    Add-Content `
        -LiteralPath $startupLogPath `
        -Value ("{0} {1}" -f [DateTimeOffset]::UtcNow.ToString('O'), $Message) `
        -Encoding utf8
}

$evidence = [ordered]@{
    Verdict = 'FAIL'
    CheckedAtUtc = [DateTimeOffset]::UtcNow.ToString('O')
    Repository = $repository
    Assembly = $assembly
    Binding = $binding
    HealthUri = $healthUri
    Identity = [Security.Principal.WindowsIdentity]::GetCurrent().Name
    BuildPerformed = $false
    StartedNewProcess = $false
}
$startedProcess = $null

try {
    $listenerPids = @(Get-ListenerProcessIds -Port 5051)
    if ($listenerPids.Count -gt 1) {
        throw 'Port 5051 has more than one listener owner.'
    }
    if ($listenerPids.Count -eq 1) {
        $existingProcess = Get-ProcessRecord -ProcessId $listenerPids[0]
        if (-not (Test-ApprovedFrontendProcess $existingProcess)) {
            throw (
                'Port 5051 is owned by an unrelated process. ' +
                "PID: $($listenerPids[0]).")
        }
        $evidence.ProcessId = [int]$listenerPids[0]
        $evidence.AlreadyRunning = $true
        Write-StartupLog (
            "Approved process $($listenerPids[0]) already owns port 5051.")
        $evidence.Health = Test-FrontendHealth
        $evidence.Verdict = 'PASS'
        $evidence |
            ConvertTo-Json -Depth 6 |
            Set-Content -LiteralPath $evidencePath -Encoding utf8
        Write-StartupLog 'Existing process health check passed.'
        Write-Host (
            'Development Frontend is already running on port 5051 ' +
            "(PID $($listenerPids[0])).")
        [pscustomobject]$evidence
        exit 0
    }

    $buildRequired = -not (
        (Test-Path -LiteralPath $assembly -PathType Leaf) -and
        (Test-Path -LiteralPath $runtimeSettings -PathType Leaf))
    if (-not $buildRequired) {
        $assemblyTime = (Get-Item -LiteralPath $assembly).LastWriteTimeUtc
        $sourceInputs = Get-ChildItem `
            -LiteralPath $projectDirectory `
            -Recurse `
            -File |
            Where-Object {
                $_.FullName -notmatch '[\\/](bin|obj)[\\/]' -and
                $_.Extension -in '.cs', '.csproj', '.json'
            }
        $buildRequired = $null -ne (
            $sourceInputs |
                Where-Object { $_.LastWriteTimeUtc -gt $assemblyTime } |
                Select-Object -First 1)
    }

    if ($buildRequired) {
        & $dotnet build $project --configuration Release --nologo
        if ($LASTEXITCODE -ne 0) {
            throw 'Development Frontend Release build failed.'
        }
        $evidence.BuildPerformed = $true
    }
    if (-not (Test-Path -LiteralPath $assembly -PathType Leaf)) {
        throw "Development Frontend assembly is absent: $assembly"
    }
    if (-not (Test-Path -LiteralPath $runtimeSettings -PathType Leaf)) {
        throw "Development Frontend settings are absent: $runtimeSettings"
    }

    $listenerPids = @(Get-ListenerProcessIds -Port 5051)
    if ($listenerPids.Count -ne 0) {
        throw 'Port 5051 became occupied during startup preparation.'
    }

    $startInfo = [Diagnostics.ProcessStartInfo]::new()
    $startInfo.FileName = $dotnet
    $startInfo.Arguments = (
        '"{0}" --contentRoot "{1}" --urls {2} --RepositoryRoot "{3}"' -f
            $assembly,
            $runtime,
            $binding,
            $repository)
    $startInfo.WorkingDirectory = $runtime
    $startInfo.UseShellExecute = $true
    $startInfo.WindowStyle = [Diagnostics.ProcessWindowStyle]::Hidden
    Write-StartupLog 'Starting detached process.'
    $startedProcess = [Diagnostics.Process]::Start($startInfo)
    if ($null -eq $startedProcess) {
        throw 'Windows did not return the Development Frontend process.'
    }
    Write-StartupLog "Process $($startedProcess.Id) created."
    $evidence.ProcessId = $startedProcess.Id
    $evidence.StartedNewProcess = $true
    $evidence.Health = Test-FrontendHealth
    Write-StartupLog 'Health check passed.'

    $listenerPids = @(Get-ListenerProcessIds -Port 5051)
    if (
        $listenerPids.Count -ne 1 -or
        $listenerPids[0] -ne $startedProcess.Id
    ) {
        throw 'The launched process does not exclusively own port 5051.'
    }
    if (@(Get-ListenerProcessIds -Port 5000) -contains $startedProcess.Id) {
        throw 'The launched process unexpectedly owns port 5000.'
    }

    $evidence.AlreadyRunning = $false
    $evidence.Verdict = 'PASS'
    $evidence |
        ConvertTo-Json -Depth 6 |
            Set-Content -LiteralPath $evidencePath -Encoding utf8
    Write-StartupLog 'Launcher completed successfully.'
    [pscustomobject]$evidence
}
catch {
    $evidence.Error = $_.Exception.Message
    $evidence |
        ConvertTo-Json -Depth 6 |
            Set-Content -LiteralPath $evidencePath -Encoding utf8
    Write-StartupLog ("Launcher failed: {0}" -f $_.Exception.Message)
    if ($null -ne $startedProcess -and -not $startedProcess.HasExited) {
        Stop-Process `
            -Id $startedProcess.Id `
            -Force `
            -ErrorAction SilentlyContinue
    }
    throw
}
