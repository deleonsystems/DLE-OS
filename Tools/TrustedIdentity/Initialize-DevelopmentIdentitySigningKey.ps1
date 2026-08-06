[CmdletBinding()]
param(
    [string] $KeyDirectory = 'C:\ProgramData\DLE-OS\DevelopmentIdentity\Keys',
    [string] $EvidencePath = 'C:\ProgramData\DLE-OS\DevelopmentIdentity\key-generation-evidence.json'
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = [Security.Principal.WindowsPrincipal]::new($identity)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw 'Development identity key generation requires an elevated Administrator token.'
}

$privatePath = Join-Path $KeyDirectory 'issuer-private.pem'
$publicPath = Join-Path $KeyDirectory 'validator-public.pem'
if ((Test-Path -LiteralPath $privatePath) -or (Test-Path -LiteralPath $publicPath)) {
    throw 'Development identity signing material already exists. Use the documented rotation procedure.'
}

New-Item -ItemType Directory -Path $KeyDirectory -Force | Out-Null
$generator = Join-Path $PSScriptRoot `
    'DleOs.TrustedIdentity.KeyGen\DleOs.TrustedIdentity.KeyGen.csproj'
dotnet run --project $generator -c Release -- $KeyDirectory
if ($LASTEXITCODE -ne 0) { throw 'The development identity key generator failed.' }

icacls.exe $KeyDirectory /inheritance:r | Out-Null
icacls.exe $KeyDirectory /grant:r 'SYSTEM:(OI)(CI)F' 'BUILTIN\Administrators:(OI)(CI)F' `
    'DLE-OS-HOST\DLE-OS:(OI)(CI)R' | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'The signing-key directory ACL could not be secured.' }

$evidence = [ordered]@{
    Verdict = 'PASS'
    GeneratedAtUtc = [DateTimeOffset]::UtcNow.ToString('O')
    GeneratedBy = $identity.Name
    Algorithm = 'ECDSA P-256 / ES256'
    KeyDirectory = $KeyDirectory
    PrivateKeyPath = $privatePath
    PublicKeyPath = $publicPath
    PrivateKeySha256 = (Get-FileHash -LiteralPath $privatePath -Algorithm SHA256).Hash
    PublicKeySha256 = (Get-FileHash -LiteralPath $publicPath -Algorithm SHA256).Hash
    KeyMaterialIncluded = $false
}
New-Item -ItemType Directory -Path (Split-Path $EvidencePath -Parent) -Force | Out-Null
$evidence | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $EvidencePath -Encoding utf8
[pscustomobject]$evidence
