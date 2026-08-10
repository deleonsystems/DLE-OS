[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [string]$OutputRoot,

    [ValidateRange(30,480)]
    [int]$ValidMinutes = 240
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'DleOsDevelopmentFrontendBootstrapCrypto.ps1')

if ($env:COMPUTERNAME -ine 'DLE-OS-HOST') {
    throw "The bootstrap request must originate on DLE-OS-HOST, not $env:COMPUTERNAME."
}
$transactionId = [Guid]::NewGuid().ToString('D')
$transactionDirectory = Join-Path $OutputRoot $transactionId
$hostDirectory = Join-Path $transactionDirectory 'host-state'
$serverPackageDirectory = Join-Path $transactionDirectory 'server-package'
if (Test-Path -LiteralPath $transactionDirectory) { throw "Bootstrap directory already exists: $transactionDirectory" }
New-Item -ItemType Directory -Path $hostDirectory -Force | Out-Null
New-Item -ItemType Directory -Path $serverPackageDirectory -Force | Out-Null
$rsa = $null
$privateBytes = $null
$protectedPrivate = $null
$entropy = $null
try {
    $legacySourceName = 'DleOsLegacyFileServerBootstrap.cs'
    $legacyManifestName = 'DleOsLegacyFileServerBootstrap.manifest'
    $legacyExecutableName = 'DleOsLegacyFileServerBootstrap.exe'
    $powerShell2LauncherName = 'Invoke-DleOsLegacyFileServerBootstrapPowerShell2.ps1'
    $launcherName = 'Run-TransactionA-On-DELEON-SERVER.cmd'
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot $legacySourceName) -Destination (Join-Path $serverPackageDirectory $legacySourceName)
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot $legacyManifestName) -Destination (Join-Path $serverPackageDirectory $legacyManifestName)
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot $powerShell2LauncherName) -Destination (Join-Path $serverPackageDirectory $powerShell2LauncherName)
    $compiler = @(
        (Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'),
        (Join-Path $env:WINDIR 'Microsoft.NET\Framework\v4.0.30319\csc.exe')
    ) | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } | Select-Object -First 1
    if (-not $compiler) { throw 'The governed .NET Framework 4 compiler is absent.' }
    $compilerArguments = @(
        '/nologo','/target:exe','/platform:anycpu','/optimize+',
        ('/out:{0}' -f (Join-Path $serverPackageDirectory $legacyExecutableName)),
        ('/win32manifest:{0}' -f (Join-Path $serverPackageDirectory $legacyManifestName)),
        '/reference:System.dll','/reference:System.Core.dll','/reference:System.Security.dll',
        '/reference:System.DirectoryServices.dll','/reference:System.Management.dll',
        '/reference:System.Web.Extensions.dll',(Join-Path $serverPackageDirectory $legacySourceName)
    )
    $compilerOutput = & $compiler @compilerArguments 2>&1 | Out-String
    if ($LASTEXITCODE -ne 0) { throw "Legacy Transaction A compile failed ($LASTEXITCODE): $compilerOutput" }
    $launcher = @"
@echo off
setlocal
set "TRANSACTION_ID=$transactionId"
set "OUTPUT=C:\ProgramData\DLE-OS\DevelopmentFrontend\Bootstrap\$transactionId"
set "LAUNCH_LOG=C:\DLE-OS\Bootstrap\TransactionA-$transactionId-launcher.log"
set "EXIT_MARKER=C:\DLE-OS\Bootstrap\TransactionA-$transactionId-launcher.exitcode"
net.exe session >nul 2>&1
if errorlevel 1 (
  echo ERROR: Run this command only from an Administrator Command Prompt.
  exit /b 5
)
if /I not "%COMPUTERNAME%"=="DELEON-SERVER" (
  echo ERROR: Transaction A may run only on DELEON-SERVER.
  exit /b 2
)
if exist "%OUTPUT%" (
  echo ERROR: Transaction output already exists. Refusing to retry.
  exit /b 3
)
if exist "%EXIT_MARKER%" del /q "%EXIT_MARKER%"
>"%LAUNCH_LOG%" echo [%date% %time%] Windows Server 2008 R2 launcher started as %USERDOMAIN%\%USERNAME% on %COMPUTERNAME%.
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0$powerShell2LauncherName" -BootstrapRequestPath "%~dp0bootstrap-request.json" -OutputDirectory "%OUTPUT%" >>"%LAUNCH_LOG%" 2>&1
if not exist "%EXIT_MARKER%" (
  >>"%LAUNCH_LOG%" echo PowerShell 2 did not produce its required exit-code marker.
  exit /b 11
)
set /p TRANSACTION_EXIT=<"%EXIT_MARKER%"
>>"%LAUNCH_LOG%" echo [%date% %time%] Transaction A exit code: %TRANSACTION_EXIT%
if not "%TRANSACTION_EXIT%"=="0" (
  echo Transaction A failed or elevation was declined. No retry should be attempted.
  echo Log: %LAUNCH_LOG%
  pause
)
exit /b %TRANSACTION_EXIT%
"@
    Write-DleOsUtf8File (Join-Path $serverPackageDirectory $launcherName) $launcher
    $packageFiles = @($legacySourceName,$legacyManifestName,$legacyExecutableName,$powerShell2LauncherName,$launcherName)
    $codeManifest = [ordered]@{
        Schema = 'DLE-OS-DEV-FRONTEND-FILESERVER-LEGACY-CODE-MANIFEST-V2'
        Target = 'Windows Server 2008 R2 / Windows PowerShell 2 / in-memory CLR 2 transaction'
        Files = @($packageFiles | ForEach-Object {
            [ordered]@{Name=$_;Sha256=Get-DleOsFileSha256 (Join-Path $serverPackageDirectory $_)}
        })
    }
    $codeManifestPath = Join-Path $serverPackageDirectory 'bootstrap-code-manifest.json'
    Write-DleOsUtf8File $codeManifestPath ($codeManifest | ConvertTo-Json -Depth 6)
    $codeManifestHash = Get-DleOsFileSha256 $codeManifestPath

    $csp = New-Object Security.Cryptography.CspParameters
    $csp.ProviderType = 24
    $csp.Flags = [Security.Cryptography.CspProviderFlags]::UseMachineKeyStore
    $rsa = New-Object Security.Cryptography.RSACryptoServiceProvider -ArgumentList 3072,$csp
    $rsa.PersistKeyInCsp = $false
    $public = ConvertTo-DleOsRsaParametersRecord ($rsa.ExportParameters($false))
    $private = ConvertTo-DleOsRsaParametersRecord ($rsa.ExportParameters($true)) -IncludePrivate
    $issued = [DateTimeOffset]::UtcNow
    $nonceBytes = New-Object byte[] 32
    $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
    $rng.GetBytes($nonceBytes)
    $rng.Dispose()
    try {
        $request = [ordered]@{
            Schema = 'DLE-OS-DEV-FRONTEND-FILESERVER-BOOTSTRAP-REQUEST-V2'
            TransactionId = $transactionId
            IssuedAtUtc = $issued.ToString('o')
            ExpiresAtUtc = $issued.AddMinutes($ValidMinutes).ToString('o')
            SourceComputer = 'DLE-OS-HOST'
            TargetComputer = 'DELEON-SERVER'
            AccountName = 'DLE-OS-DEV-FRONTEND'
            ShareName = 'Production'
            AllowedRelativePaths = @('KITTING\KIT-SHORTAGES','KITTING\KIT-COMPLETE')
            UnrelatedProbeRelativePath = 'Customer Files'
            Nonce = [Convert]::ToBase64String($nonceBytes)
            PasswordEncryption = 'RSA-3072-OAEP-SHA1-CSP'
            CodeManifestSha256 = $codeManifestHash
            PublicKey = $public
        }
        $requestPath = Join-Path $hostDirectory 'bootstrap-request.json'
        Write-DleOsUtf8File $requestPath ($request | ConvertTo-Json -Depth 8)
        $requestHash = Get-DleOsFileSha256 $requestPath
        Write-DleOsUtf8File (Join-Path $hostDirectory 'bootstrap-request.sha256') ($requestHash + "`n")
        Copy-Item -LiteralPath $requestPath -Destination (Join-Path $serverPackageDirectory 'bootstrap-request.json')
        Copy-Item -LiteralPath (Join-Path $hostDirectory 'bootstrap-request.sha256') -Destination (Join-Path $serverPackageDirectory 'bootstrap-request.sha256')

        $privateState = [ordered]@{
            Schema = 'DLE-OS-DEV-FRONTEND-HOST-PRIVATE-HANDOFF-V2'
            TransactionId = $transactionId
            RequestSha256 = $requestHash
            Nonce = $request.Nonce
            PrivateKey = $private
        }
        $privateBytes = [Text.Encoding]::UTF8.GetBytes(($privateState | ConvertTo-Json -Depth 8 -Compress))
        $entropy = [Text.Encoding]::UTF8.GetBytes("DLE-OS|DEV-FRONTEND|$transactionId|HOST-HANDOFF-V2")
        $protectedPrivate = Protect-DleOsBytes $privateBytes $entropy CurrentUser
        $privatePath = Join-Path $hostDirectory 'host-private-handoff.dpapi'
        [IO.File]::WriteAllBytes($privatePath,$protectedPrivate)
        $owner = [Security.Principal.WindowsIdentity]::GetCurrent().User
        Set-DleOsSecretFileAcl $privatePath $owner

        $archivePath = Join-Path $transactionDirectory ("DLE-OS-DEV-FRONTEND-DELEON-SERVER-{0}.zip" -f $transactionId)
        Compress-Archive -Path (Join-Path $serverPackageDirectory '*') -DestinationPath $archivePath
        [pscustomobject]@{
            Verdict='PASS';TransactionId=$transactionId;Directory=$hostDirectory
            RequestPath=$requestPath;RequestSha256=$requestHash
            PrivateHandoffPath=$privatePath;ServerPackageDirectory=$serverPackageDirectory
            CodeManifestSha256=$codeManifestHash;ArchivePath=$archivePath
            ArchiveSha256=Get-DleOsFileSha256 $archivePath;LegacyTarget='Windows Server 2008 R2'
            PlaintextPasswordPersisted=$false
        }
    }
    finally { [Array]::Clear($nonceBytes,0,$nonceBytes.Length) }
}
finally {
    if ($privateBytes) { [Array]::Clear($privateBytes,0,$privateBytes.Length) }
    if ($protectedPrivate) { [Array]::Clear($protectedPrivate,0,$protectedPrivate.Length) }
    if ($entropy) { [Array]::Clear($entropy,0,$entropy.Length) }
    if ($rsa) { $rsa.Dispose() }
}
