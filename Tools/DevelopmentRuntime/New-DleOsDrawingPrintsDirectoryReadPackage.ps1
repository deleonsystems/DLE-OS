[CmdletBinding()]
param(
    [Parameter(Mandatory=$true)]
    [string]$OutputRoot
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Get-Sha256([string]$Path) {
    $stream = [IO.File]::OpenRead($Path)
    $sha = [Security.Cryptography.SHA256]::Create()
    try { return ([BitConverter]::ToString($sha.ComputeHash($stream))).Replace('-', '') }
    finally { $sha.Clear(); $stream.Close() }
}

function Write-Utf8([string]$Path, [string]$Value) {
    [IO.File]::WriteAllText($Path, $Value, [Text.UTF8Encoding]::new($false))
}

if ($env:COMPUTERNAME -ine 'DLE-OS-HOST') {
    throw 'The Drawing-Prints transaction package must be generated on DLE-OS-HOST.'
}

$transactionId = [Guid]::NewGuid().ToString('D')
$package = Join-Path $OutputRoot ('drawing-prints-directory-read-' + $transactionId)
if (Test-Path -LiteralPath $package) { throw "Package already exists: $package" }
New-Item -ItemType Directory -Path $package | Out-Null

$scriptName = 'Invoke-DleOsDrawingPrintsDirectoryReadTransaction.ps1'
$source = Join-Path $PSScriptRoot $scriptName
$destination = Join-Path $package $scriptName
Copy-Item -LiteralPath $source -Destination $destination
$scriptHash = Get-Sha256 $destination
$evidenceDirectory = 'C:\ProgramData\DLE-OS\DrawingPrintsAcl\' + $transactionId

$apply = @"
@echo off
setlocal
net.exe session >nul 2>&1
if errorlevel 1 (
  echo ERROR: Run this command from an elevated Administrator Command Prompt on DELEON-SERVER.
  exit /b 5
)
if /I not "%COMPUTERNAME%"=="DELEON-SERVER" (
  echo ERROR: This package may run only on DELEON-SERVER.
  exit /b 2
)
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0$scriptName" -Mode Apply -EvidenceDirectory "$evidenceDirectory" -ExpectedScriptSha256 "$scriptHash"
set EXITCODE=%ERRORLEVEL%
if not "%EXITCODE%"=="0" pause
exit /b %EXITCODE%
"@
$apply = $apply.Replace(
    'powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0' + $scriptName + '" -Mode Apply',
    'powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0' + $scriptName + '" -Mode Preflight -EvidenceDirectory "' + $evidenceDirectory + '" -ExpectedScriptSha256 "' + $scriptHash + '"' + "`r`n" +
    'if errorlevel 1 (pause & exit /b %ERRORLEVEL%)' + "`r`n" +
    'powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0' + $scriptName + '" -Mode Apply')
$rollback = @"
@echo off
setlocal
net.exe session >nul 2>&1
if errorlevel 1 (
  echo ERROR: Run this command from an elevated Administrator Command Prompt on DELEON-SERVER.
  exit /b 5
)
if /I not "%COMPUTERNAME%"=="DELEON-SERVER" (
  echo ERROR: This package may run only on DELEON-SERVER.
  exit /b 2
)
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0$scriptName" -Mode Rollback -EvidenceDirectory "$evidenceDirectory" -ExpectedScriptSha256 "$scriptHash"
set EXITCODE=%ERRORLEVEL%
if not "%EXITCODE%"=="0" pause
exit /b %EXITCODE%
"@
$readme = @"
DLE-OS Drawing-Prints directory-enumeration ACL transaction

Transaction ID: $transactionId
Target computer: DELEON-SERVER
Target share/path: Production\Drawing-Prints
Authorized identity: DELEON-SERVER\DLE-OS-DEV-FRONTEND
Expected SID: S-1-5-21-2944932128-830765809-3256817259-1042
Rights: ReadAndExecute on directories, ContainerInherit only; no ObjectInherit
Share change: none
Evidence: $evidenceDirectory

Run Apply-On-DELEON-SERVER.cmd only from an elevated local Administrator Command Prompt on DELEON-SERVER.
Do not run the rollback unless the applied boundary must be removed after review.
"@
Write-Utf8 (Join-Path $package 'Apply-On-DELEON-SERVER.cmd') $apply
Write-Utf8 (Join-Path $package 'Rollback-On-DELEON-SERVER.cmd') $rollback
Write-Utf8 (Join-Path $package 'README.txt') $readme

$manifestLines = @(
    'Schema=DLE-OS-DRAWING-PRINTS-DIRECTORY-READ-PACKAGE-V1',
    ('TransactionId=' + $transactionId),
    'TargetComputer=DELEON-SERVER',
    'TargetRelativePath=Drawing-Prints',
    'Account=DELEON-SERVER\DLE-OS-DEV-FRONTEND',
    'Sid=S-1-5-21-2944932128-830765809-3256817259-1042',
    ('TransactionScriptSha256=' + $scriptHash),
    ('ApplyLauncherSha256=' + (Get-Sha256 (Join-Path $package 'Apply-On-DELEON-SERVER.cmd'))),
    ('RollbackLauncherSha256=' + (Get-Sha256 (Join-Path $package 'Rollback-On-DELEON-SERVER.cmd'))),
    ('ReadmeSha256=' + (Get-Sha256 (Join-Path $package 'README.txt')))
)
$manifestPath = Join-Path $package 'package-manifest.txt'
Write-Utf8 $manifestPath (($manifestLines -join "`r`n") + "`r`n")
Write-Utf8 ($manifestPath + '.sha256') ((Get-Sha256 $manifestPath) + "`r`n")

$archive = $package + '.zip'
Compress-Archive -Path (Join-Path $package '*') -DestinationPath $archive
[pscustomobject]@{
    Verdict = 'PASS'
    TransactionId = $transactionId
    PackageDirectory = $package
    Archive = $archive
    ArchiveSha256 = Get-Sha256 $archive
    TransactionScriptSha256 = $scriptHash
    EvidenceDirectory = $evidenceDirectory
}
