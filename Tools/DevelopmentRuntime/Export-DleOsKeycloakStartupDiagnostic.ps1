[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repository = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')).Path
$outputDirectory = Join-Path $repository '.tmp\phase62c-keycloak'
$outputPath = Join-Path $outputDirectory 'startup-diagnostic.txt'
$logRoot = 'C:\ProgramData\DLE-OS\Keycloak\Logs'

function Test-IsAdministrator {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = [Security.Principal.WindowsPrincipal]::new($identity)
    return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

if (-not (Test-IsAdministrator)) {
    $arguments = @('-NoLogo','-NoProfile','-ExecutionPolicy','Bypass','-File',('"{0}"' -f $PSCommandPath))
    $process = Start-Process powershell.exe -Verb RunAs -ArgumentList $arguments -Wait -PassThru
    exit $process.ExitCode
}

New-Item -ItemType Directory -Path $outputDirectory -Force | Out-Null
$lines = [Collections.Generic.List[string]]::new()
$lines.Add('DLE-OS Phase 6.2C Keycloak startup diagnostic')
$lines.Add(('CapturedAtUtc: ' + [DateTimeOffset]::UtcNow.ToString('o')))
$lines.Add(('CaptureIdentity: ' + [Security.Principal.WindowsIdentity]::GetCurrent().Name))
$lines.Add('Mode: read-only, secret-bearing lines excluded')

$files = @(Get-ChildItem -LiteralPath $logRoot -File -Force |
    Where-Object Extension -in '.log','.out','.err','.txt' |
    Sort-Object LastWriteTime)
$lines.Add(('LogFileCount: ' + $files.Count))
foreach ($file in $files) {
    $lines.Add('')
    $lines.Add(('FILE: {0} | Length={1} | LastWriteTimeUtc={2}' -f
        $file.Name,$file.Length,$file.LastWriteTimeUtc.ToString('o')))
    foreach ($line in @(Get-Content -LiteralPath $file.FullName -Tail 250 -ErrorAction Continue)) {
        if ($line -match '(?i)password|secret|authorization|bearer|token|cookie') {
            $lines.Add('[REDACTED SECRET-BEARING LINE]')
        }
        else {
            $lines.Add([string]$line)
        }
    }
}

$lines | Set-Content -LiteralPath $outputPath -Encoding UTF8
Write-Host "KEYCLOAK_DIAGNOSTIC_EXPORTED: $outputPath"
