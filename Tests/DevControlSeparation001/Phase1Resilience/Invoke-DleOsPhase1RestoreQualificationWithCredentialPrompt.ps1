[CmdletBinding()]
param(
    [string]$RepositoryRoot='C:\DLE-OS\Repositories\DLE-OS',
    [string]$QualificationRoot='C:\DLE-OS\Qualification\DevResilience\Phase1'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$machineModulePath = [Environment]::GetEnvironmentVariable('PSModulePath','Machine')
$userModulePath = [Environment]::GetEnvironmentVariable('PSModulePath','User')
$env:PSModulePath = (@($userModulePath,$machineModulePath) | Where-Object { -not [string]::IsNullOrWhiteSpace($_) }) -join ';'

$identity = [Security.Principal.WindowsIdentity]::GetCurrent().Name
if (-not [string]::Equals($identity,'DLE-OS-HOST\Miguel',[StringComparison]::OrdinalIgnoreCase)) {
    throw "Credential launcher requires DLE-OS-HOST\Miguel; current identity is $identity."
}

$launcherStamp = [DateTimeOffset]::UtcNow.ToString('yyyyMMddTHHmmssZ')
$launcherLog = Join-Path $QualificationRoot ('phase1-restore-credential-launcher-' + $launcherStamp + '.log')
Start-Transcript -LiteralPath $launcherLog -Force | Out-Null

$scriptPath = Join-Path $RepositoryRoot 'Tests\DevControlSeparation001\Phase1Resilience\Invoke-DleOsPhase1RestoreQualification.ps1'
if (-not (Test-Path -LiteralPath $scriptPath -PathType Leaf)) { throw "Restore qualification script is absent: $scriptPath" }

try {
    $runStamp = [DateTimeOffset]::UtcNow.ToString('yyyyMMddTHHmmssZ')
    $runId = 'phase1-restore-qualification-' + $runStamp
    $runRoot = Join-Path $QualificationRoot $runId
    $null = New-Item -ItemType Directory -Path $runRoot -Force
    $attestationPath = Join-Path $runRoot 'backup-hash-attestation.json'
    $backupDefinitions = @(
        [ordered]@{Database='DLE_OS_OPERATIONAL_DEV';GovernedPath='C:\DLE-OS\Backups\DevResilience\phase1-database-backup-20260826T044836Z\DLE_OS_OPERATIONAL_DEV_20260826T044836Z_COPY_ONLY_CHECKSUM.bak';SqlPath='C:\Program Files\Microsoft SQL Server\MSSQL16.SQLEXPRESS\MSSQL\Backup\DLE_OS_OPERATIONAL_DEV_20260826T044836Z_COPY_ONLY_CHECKSUM.bak';ExpectedSha256='5AED4F19FF33328E727A5D2C39FCF3E7C0009919F4D56B9413450C3684A7894D'},
        [ordered]@{Database='DLE_OS_SECURITY_DEV';GovernedPath='C:\DLE-OS\Backups\DevResilience\phase1-database-backup-20260826T044836Z\DLE_OS_SECURITY_DEV_20260826T044836Z_COPY_ONLY_CHECKSUM.bak';SqlPath='C:\Program Files\Microsoft SQL Server\MSSQL16.SQLEXPRESS\MSSQL\Backup\DLE_OS_SECURITY_DEV_20260826T044836Z_COPY_ONLY_CHECKSUM.bak';ExpectedSha256='CA1B269F53108548183A5483B7C5F0D47B4E87F2EA1A25929B2F8B2B57AA43ED'}
    )
    $attestedBackups = @($backupDefinitions | ForEach-Object {
        $governedHash = (Get-FileHash -LiteralPath $_.GovernedPath -Algorithm SHA256).Hash
        $sqlHash = (Get-FileHash -LiteralPath $_.SqlPath -Algorithm SHA256).Hash
        if ($governedHash -cne $_.ExpectedSha256 -or $sqlHash -cne $_.ExpectedSha256) { throw "Backup hash mismatch for $($_.Database)." }
        [ordered]@{Database=$_.Database;GovernedPath=$_.GovernedPath;SqlPath=$_.SqlPath;ExpectedSha256=$_.ExpectedSha256;GovernedSha256=$governedHash;SqlSha256=$sqlHash;Passed=$true}
    })
    [ordered]@{Schema='dle-os.phase1-backup-hash-attestation.v1';CapturedUtc=[DateTimeOffset]::UtcNow;Identity=$identity;Backups=$attestedBackups;Passed=$true} |
        ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $attestationPath -Encoding UTF8
    $attestationSha256 = (Get-FileHash -LiteralPath $attestationPath -Algorithm SHA256).Hash

    $credential = $Host.UI.PromptForCredential(
        'DLE-OS Phase 1 restore qualification',
        'Enter the existing governed DLE-OS recovery-account credential. It is used only in memory for this run.',
        'DLE-OS-HOST\DLE-OS',
        'DLE-OS-HOST'
    )
    if ($null -eq $credential) { throw 'The governed recovery credential prompt was cancelled.' }
    if (-not [string]::Equals($credential.UserName,'DLE-OS-HOST\DLE-OS',[StringComparison]::OrdinalIgnoreCase)) {
        throw "Only DLE-OS-HOST\DLE-OS is authorized for this qualification; entered identity was $($credential.UserName)."
    }

    $argument = '-NoProfile -ExecutionPolicy Bypass -File "' + $scriptPath + '" -OutputRoot "' + $QualificationRoot + '" -HashAttestationPath "' + $attestationPath + '" -HashAttestationSha256 "' + $attestationSha256 + '" -RunId "' + $runId + '"'
    Start-Process -FilePath "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe" `
        -ArgumentList $argument -Credential $credential -LoadUserProfile -WorkingDirectory $RepositoryRoot

    $resultPath = Join-Path $runRoot 'phase1-restore-qualification.json'
    $deadline = [DateTimeOffset]::UtcNow.AddMinutes(45)
    do {
        Start-Sleep -Seconds 2
        if (Test-Path -LiteralPath $resultPath -PathType Leaf) {
            try {
                $result = Get-Content -LiteralPath $resultPath -Raw | ConvertFrom-Json
                if ($null -ne $result.CompletedUtc) { break }
            } catch {}
        }
        if ([DateTimeOffset]::UtcNow -gt $deadline) { throw 'Timed out waiting for governed restore qualification evidence.' }
    } while ($true)
    $result = Get-Content -LiteralPath $resultPath -Raw | ConvertFrom-Json
    if (-not $result.Passed) { throw "Restore qualification evidence did not pass: $($result.Error) ($resultPath)" }
    Write-Host "Phase 1 restore qualification passed: $resultPath" -ForegroundColor Green
}
catch {
    Write-Error $_
    throw
}
finally {
    Stop-Transcript | Out-Null
}
