[CmdletBinding()]
param(
    [ValidateRange(1024, 65535)]
    [int] $Port = 5177,

    [switch] $Lan,

    [string] $LanAddress,

    [string] $LanHostName,

    [ValidatePattern('^[A-Fa-f0-9 ]{40,128}$')]
    [string] $CertificateThumbprint
)

$ErrorActionPreference = 'Stop'
$repository = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$project = Join-Path $PSScriptRoot 'DleOs.SimHost\DleOs.SimHost.csproj'
$lanEnvironmentNames = @(
    'DLE_OS_SIM_LAN_MODE',
    'DLE_OS_SIM_LAN_ADDRESS',
    'DLE_OS_SIM_LAN_HOSTNAME',
    'DLE_OS_SIM_CERTIFICATE_THUMBPRINT',
    'DLE_OS_SIM_ACCESS_CODE'
)
$previousEnvironment = @{}
foreach ($name in @('DLE_OS_SIM_PORT') + $lanEnvironmentNames) {
    $previousEnvironment[$name] = [Environment]::GetEnvironmentVariable($name)
}

try {
    $env:DLE_OS_SIM_PORT = [string]$Port
    foreach ($name in $lanEnvironmentNames) {
        Remove-Item -Path "Env:$name" -ErrorAction SilentlyContinue
    }

    if ($Lan) {
        if ([string]::IsNullOrWhiteSpace($LanAddress) -or
            [string]::IsNullOrWhiteSpace($LanHostName) -or
            [string]::IsNullOrWhiteSpace($CertificateThumbprint)) {
            throw 'LAN mode requires -LanAddress, -LanHostName, and -CertificateThumbprint.'
        }

        $address = $null
        if (-not [Net.IPAddress]::TryParse($LanAddress, [ref]$address) -or
            $address.AddressFamily -ne [Net.Sockets.AddressFamily]::InterNetwork) {
            throw '-LanAddress must be one explicit IPv4 address.'
        }
        $bytes = $address.GetAddressBytes()
        $private = $bytes[0] -eq 10 -or
            ($bytes[0] -eq 172 -and $bytes[1] -ge 16 -and $bytes[1] -le 31) -or
            ($bytes[0] -eq 192 -and $bytes[1] -eq 168)
        if (-not $private) { throw '-LanAddress must be an RFC1918 private IPv4 address.' }

        $ipConfiguration = Get-NetIPAddress -AddressFamily IPv4 -IPAddress $LanAddress -ErrorAction Stop |
            Where-Object AddressState -eq 'Preferred' | Select-Object -First 1
        if ($null -eq $ipConfiguration) {
            throw "LAN address $LanAddress is not currently assigned to this workstation."
        }
        $profile = Get-NetConnectionProfile -InterfaceIndex $ipConfiguration.InterfaceIndex -ErrorAction Stop
        if ($profile.NetworkCategory -ne 'Private') {
            throw "LAN mode refuses the $($profile.NetworkCategory) network profile on $($profile.InterfaceAlias)."
        }

        $alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
        $randomBytes = [byte[]]::new(12)
        [Security.Cryptography.RandomNumberGenerator]::Fill($randomBytes)
        $accessCode = -join ($randomBytes | ForEach-Object { $alphabet[$_ % $alphabet.Length] })
        $safeHostName = $LanHostName.Trim().TrimEnd('.').ToLowerInvariant()
        $safeUrl = "https://$safeHostName`:$Port"

        $env:DLE_OS_SIM_LAN_MODE = 'true'
        $env:DLE_OS_SIM_LAN_ADDRESS = $LanAddress
        $env:DLE_OS_SIM_LAN_HOSTNAME = $safeHostName
        $env:DLE_OS_SIM_CERTIFICATE_THUMBPRINT = $CertificateThumbprint.Replace(' ', '')
        $env:DLE_OS_SIM_ACCESS_CODE = $accessCode

        Write-Host "Starting DLE-OS SIM in LAN MODE at $safeUrl"
        Write-Host "Bound private address: $LanAddress (Private profile only)"
        Write-Host "One-run device access code: $accessCode"
    }
    else {
        if ($LanAddress -or $LanHostName -or $CertificateThumbprint) {
            throw 'LAN settings require the explicit -Lan switch.'
        }
        Write-Host "Starting DLE-OS SIM at http://127.0.0.1:$Port"
    }
    Write-Host 'Press Ctrl+C to stop the local SIM host.'
    & dotnet run --project $project --no-launch-profile
    if ($LASTEXITCODE -ne 0) {
        throw "DLE-OS SIM exited with code $LASTEXITCODE."
    }
}
finally {
    foreach ($name in $previousEnvironment.Keys) {
        if ($null -eq $previousEnvironment[$name]) {
            Remove-Item -Path "Env:$name" -ErrorAction SilentlyContinue
        }
        else {
            Set-Item -Path "Env:$name" -Value $previousEnvironment[$name]
        }
    }
}
