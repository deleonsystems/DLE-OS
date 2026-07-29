[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$repository = 'C:\DLE-OS\Repositories\DLE-OS'
$probeRoot = 'C:\Add-On\Lab\CMProbe'
$compileRoot = Join-Path $probeRoot 'Compile'
$programRoot = Join-Path $probeRoot 'Programs'
$listingRoot = Join-Path $probeRoot 'Listings'
$artifactRoot = Join-Path $repository (
    'Artifacts\CustomerMasterPlatform001\' +
    'CUSTOMERMASTERPLATFORM001-20260729T170951Z')
$sourceTemplate = Join-Path $repository (
    'Tools\CustomerMaster\VPro\CUSTOMER_MASTER_LOCAL_STARTUP_PROBE.src')
$source = Join-Path $compileRoot 'CUSTOMER_MASTER_LOCAL_STARTUP_PROBE.src'
$program = Join-Path $programRoot 'CUSTOMER_MASTER_LOCAL_STARTUP_PROBE'
$config = Join-Path $programRoot 'configCMProbe.aon'
$marker = Join-Path $probeRoot 'STARTED.txt'
$longPathResult = Join-Path $probeRoot 'LONG_PATH_RESULT.txt'
$evidence = Join-Path $artifactRoot 'CUSTOMER_MASTER_VPRO_STARTUP_PROBE.json'
$compiler = 'C:\BASIS\VPRO5\pro5cpl.exe'
$lister = 'C:\BASIS\VPRO5\pro5lst.exe'
$vpro = 'C:\BASIS\VPRO5\vpro5.exe'
$process = $null

function Stop-ProbeProcess {
    if ($script:process -and -not $script:process.HasExited) {
        Stop-Process -Id $script:process.Id -Force -ErrorAction Stop
        if (-not $script:process.WaitForExit(10000)) {
            throw 'The local startup probe process did not exit after cleanup.'
        }
    }
}

try {
    if (@(Get-Process -Name vpro5 -ErrorAction SilentlyContinue).Count) {
        throw 'A VPro5 process is already active.'
    }
    foreach ($directory in @(
        $probeRoot,
        $compileRoot,
        $programRoot,
        $listingRoot
    )) {
        New-Item -ItemType Directory -Path $directory -Force | Out-Null
    }
    Copy-Item -LiteralPath $sourceTemplate -Destination $source -Force
    $compiledSourceName = Join-Path $programRoot (
        [IO.Path]::GetFileName($source))
    $compilerStdout = Join-Path $probeRoot 'compiler.stdout.log'
    $compilerStderr = Join-Path $probeRoot 'compiler.stderr.log'
    foreach ($path in @(
        $program,
        $compiledSourceName,
        $marker,
        $longPathResult,
        $compilerStdout,
        $compilerStderr
    )) {
        if (Test-Path -LiteralPath $path -PathType Leaf) {
            Remove-Item -LiteralPath $path -Force
        }
    }
    @(
        'ALIASES=4'
        'FCBS=64'
        'CIBS=64'
        'STBLEN=12000'
        "PREFIX C:/Add-On/Lab/CMProbe/Programs/ C:/BASIS/VPRO5/"
        'SETOPTS 0000000000000000'
        'ALIAS T0 SYSWINDOW ""'
    ) | Set-Content -LiteralPath $config -Encoding ASCII

    $compile = Start-Process `
        -FilePath $compiler `
        -ArgumentList @("-d$programRoot", $source) `
        -WorkingDirectory $compileRoot `
        -RedirectStandardOutput $compilerStdout `
        -RedirectStandardError $compilerStderr `
        -WindowStyle Hidden `
        -Wait `
        -PassThru
    $compilerOutput = @(
        Get-Content -Raw -LiteralPath $compilerStdout `
            -ErrorAction SilentlyContinue
        Get-Content -Raw -LiteralPath $compilerStderr `
            -ErrorAction SilentlyContinue
    ) -join [Environment]::NewLine
    if (
        $compile.ExitCode -ne 0 -or
        $compilerOutput -match '(?im)\b(error|fatal)\b'
    ) {
        throw (
            "Local startup probe compile failed. Exit $($compile.ExitCode). " +
            "Output: $compilerOutput")
    }
    if (-not (Test-Path -LiteralPath $program -PathType Leaf)) {
        if (Test-Path -LiteralPath $compiledSourceName -PathType Leaf) {
            Move-Item -LiteralPath $compiledSourceName -Destination $program
        }
    }
    if (-not (Test-Path -LiteralPath $program -PathType Leaf)) {
        throw 'Local startup probe compiled program is absent.'
    }
    $listing = Start-Process `
        -FilePath $lister `
        -ArgumentList @("-d$listingRoot", '-p', $program) `
        -WorkingDirectory $listingRoot `
        -WindowStyle Hidden `
        -Wait `
        -PassThru
    if ($listing.ExitCode -ne 0) {
        throw "Local startup probe lister returned $($listing.ExitCode)."
    }

    $arguments = (
        "-tT0 -nT0 -m1024 -c$config " +
        (Split-Path -Leaf $program))
    $start = [Diagnostics.ProcessStartInfo]::new()
    $start.FileName = $vpro
    $start.Arguments = $arguments
    $start.WorkingDirectory = $programRoot
    $start.UseShellExecute = $true
    $start.WindowStyle = [Diagnostics.ProcessWindowStyle]::Normal
    $process = [Diagnostics.Process]::Start($start)
    $deadline = [DateTimeOffset]::UtcNow.AddSeconds(20)
    while (
        -not $process.HasExited -and
        -not (Test-Path -LiteralPath $marker -PathType Leaf) -and
        [DateTimeOffset]::UtcNow -lt $deadline
    ) {
        Start-Sleep -Milliseconds 250
        $process.Refresh()
    }
    $markerObserved = Test-Path -LiteralPath $marker -PathType Leaf
    if (-not $markerObserved) {
        Stop-ProbeProcess
        throw 'Local VPro startup probe produced no marker within 20 seconds.'
    }
    if (-not $process.WaitForExit(10000)) {
        Stop-ProbeProcess
        throw 'Local VPro startup probe wrote its marker but did not exit.'
    }
    if (-not (Test-Path -LiteralPath $longPathResult -PathType Leaf)) {
        throw 'Local VPro path probe did not produce its short-path verdict.'
    }
    $longPathResultText = (
        Get-Content -Raw -LiteralPath $longPathResult).Trim()
    [ordered]@{
        Verdict = 'PASS'
        CompletedAtUtc = [DateTimeOffset]::UtcNow.ToString('O')
        WindowsIdentity = (
            [Security.Principal.WindowsIdentity]::GetCurrent().Name)
        SessionId = (Get-Process -Id $PID).SessionId
        ProcessId = $process.Id
        ExitCode = $process.ExitCode
        UseShellExecute = $true
        WindowStyle = 'Normal'
        Arguments = $arguments
        ProgramSha256 = (
            Get-FileHash -LiteralPath $program -Algorithm SHA256).Hash
        ProgramListing = $listingRoot
        Marker = $marker
        MarkerContent = (Get-Content -Raw -LiteralPath $marker).Trim()
        LongPathResult = $longPathResultText
        SourceAccess = 'NONE'
        ProcessStillPresent = [bool](
            Get-Process -Id $process.Id -ErrorAction SilentlyContinue)
    } |
        ConvertTo-Json -Depth 5 |
        Set-Content -LiteralPath $evidence -Encoding UTF8
    Write-Output "PASS: $evidence"
}
catch {
    Stop-ProbeProcess
    [ordered]@{
        Verdict = 'FAIL'
        CompletedAtUtc = [DateTimeOffset]::UtcNow.ToString('O')
        WindowsIdentity = (
            [Security.Principal.WindowsIdentity]::GetCurrent().Name)
        SessionId = (Get-Process -Id $PID).SessionId
        ProcessId = if ($process) { $process.Id } else { $null }
        Error = ($_ | Out-String).Trim()
        SourceAccess = 'NONE'
        ProcessStillPresent = if ($process) {
            [bool](Get-Process -Id $process.Id -ErrorAction SilentlyContinue)
        }
        else {
            $false
        }
    } |
        ConvertTo-Json -Depth 5 |
        Set-Content -LiteralPath $evidence -Encoding UTF8
    Write-Error "Local VPro startup probe failed closed. Evidence: $evidence"
    exit 1
}
