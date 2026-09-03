[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$repository = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$project = Join-Path $repository 'Tools\SimRuntime\DleOs.SimHost\DleOs.SimHost.csproj'
$dll = Join-Path $repository 'Tools\SimRuntime\DleOs.SimHost\bin\Debug\net8.0\DleOs.SimHost.dll'
$launcher = Join-Path $repository 'Tools\SimRuntime\Start-DleOsSim.ps1'
$program = Join-Path $repository 'Tools\SimRuntime\DleOs.SimHost\Program.cs'
$options = Join-Path $repository 'Tools\SimRuntime\DleOs.SimHost\SimRuntimeOptions.cs'
$guard = Join-Path $repository 'Tools\SimRuntime\DleOs.SimHost\SimLanAccessGuard.cs'
$testRoot = Join-Path $repository '.sim-state\qualification\phase13'
$checks = [Collections.Generic.List[string]]::new()

function Require($Condition, [string]$Message) {
    if ($Condition -is [Array]) { throw "FAIL: non-Boolean test result for $Message" }
    if (-not [bool]$Condition) { throw "FAIL: $Message" }
    $checks.Add($Message)
}

Add-Type -TypeDefinition @'
using System;
using System.IO;
using System.Net;
using System.Net.Http;
using System.Net.Sockets;
using System.Threading;
using System.Threading.Tasks;

public static class SimLanTestConnector
{
    public static Func<SocketsHttpConnectionContext, CancellationToken, ValueTask<Stream>> Create(
        IPAddress address, int port)
    {
        return (_, cancellationToken) => ConnectAsync(address, port, cancellationToken);
    }

    private static async ValueTask<Stream> ConnectAsync(
        IPAddress address, int port, CancellationToken cancellationToken)
    {
        var socket = new Socket(address.AddressFamily, SocketType.Stream, ProtocolType.Tcp);
        try
        {
            await socket.ConnectAsync(new IPEndPoint(address, port), cancellationToken).ConfigureAwait(false);
            return new NetworkStream(socket, ownsSocket: true);
        }
        catch
        {
            socket.Dispose();
            throw;
        }
    }
}
'@

function Wait-Listener([int]$Port, [Diagnostics.Process]$Process) {
    for ($attempt = 0; $attempt -lt 80; $attempt++) {
        if ($Process.HasExited) { return $false }
        if ([Net.NetworkInformation.IPGlobalProperties]::GetIPGlobalProperties().GetActiveTcpListeners() |
            Where-Object Port -eq $Port) { return $true }
        Start-Sleep -Milliseconds 100
    }
    return $false
}

function Start-TestHost([string]$Name, [int]$Port, [hashtable]$Settings) {
    $stdout = Join-Path $testRoot "$Name.stdout.log"
    $stderr = Join-Path $testRoot "$Name.stderr.log"
    [IO.File]::WriteAllText($stdout, '')
    [IO.File]::WriteAllText($stderr, '')
    $previous = @{}
    foreach ($entry in $Settings.GetEnumerator()) {
        $previous[$entry.Key] = [Environment]::GetEnvironmentVariable($entry.Key)
        Set-Item -Path "Env:$($entry.Key)" -Value $entry.Value
    }
    $previous['DLE_OS_SIM_PORT'] = $env:DLE_OS_SIM_PORT
    $env:DLE_OS_SIM_PORT = [string]$Port
    try {
        return Start-Process dotnet -ArgumentList @($dll) -WorkingDirectory $repository `
            -RedirectStandardOutput $stdout -RedirectStandardError $stderr -PassThru -WindowStyle Hidden
    }
    finally {
        foreach ($name in $previous.Keys) {
            if ($null -eq $previous[$name]) { Remove-Item -Path "Env:$name" -ErrorAction SilentlyContinue }
            else { Set-Item -Path "Env:$name" -Value $previous[$name] }
        }
    }
}

function Stop-TestHost([Diagnostics.Process]$Process) {
    if ($null -ne $Process -and -not $Process.HasExited) {
        Stop-Process -Id $Process.Id -Force
        $Process.WaitForExit()
    }
}

New-Item -ItemType Directory -Path $testRoot -Force | Out-Null
& dotnet build $project --nologo --verbosity quiet
Require ($LASTEXITCODE -eq 0) 'Phase 13 SIM host builds'

$launcherText = [IO.File]::ReadAllText($launcher)
$programText = [IO.File]::ReadAllText($program)
$optionsText = [IO.File]::ReadAllText($options)
$guardText = [IO.File]::ReadAllText($guard)
Require ($launcherText -match '\[switch\] \$Lan') 'LAN exposure requires an explicit launcher switch'
Require ($programText -match 'options\.Listen\(IPAddress\.Loopback') 'default Kestrel listener remains explicit loopback'
Require ($programText -notmatch 'ListenAnyIP|IPAddress\.Any') 'SIM never binds a wildcard address'
Require ($optionsText -match 'IsPrivateIpv4' -and $optionsText -match 'IsAssignedLocalAddress') 'LAN address must be private and locally assigned'
Require ($launcherText -match "NetworkCategory -ne 'Private'") 'launcher rejects non-Private Windows network profiles'
Require ($programText -match 'DLE_OS_SIM_HOST_REJECTED') 'runtime has an exact Host allowlist rejection'
Require ($guardText -match '__Host-DLEOS-SIM-LAN' -and $guardText -match 'FixedTimeEquals') 'LAN guard uses a secure host cookie and constant-time code comparison'
Require ($programText -notmatch 'HttpClient|IHttpClientFactory|WebProxy|UseDefaultCredentials') 'LAN mode adds no downstream HTTP client or credential bridge'

$defaultPort = 5196
$defaultProcess = $null
try {
    $defaultProcess = Start-TestHost 'default' $defaultPort @{}
    Require (Wait-Listener $defaultPort $defaultProcess) 'default SIM listener starts'
    $listeners = @([Net.NetworkInformation.IPGlobalProperties]::GetIPGlobalProperties().GetActiveTcpListeners() |
        Where-Object Port -eq $defaultPort)
    Require ($listeners.Count -ge 1 -and @($listeners | Where-Object { $_.Address.ToString() -eq '127.0.0.1' }).Count -ge 1) 'default listener is bound to loopback'
    Require (@($listeners | Where-Object { $_.Address.ToString() -notin '127.0.0.1','::1' }).Count -eq 0) 'default listener is unavailable on LAN addresses'
    $status = Invoke-RestMethod "http://127.0.0.1:$defaultPort/api/sim/status" -TimeoutSec 5
    Require (-not $status.lanMode -and $status.networkBoundary -eq 'LOOPBACK_ONLY') 'default runtime reports LOOPBACK_ONLY'
}
finally { Stop-TestHost $defaultProcess }
Require (-not ([Net.NetworkInformation.IPGlobalProperties]::GetIPGlobalProperties().GetActiveTcpListeners() |
    Where-Object Port -eq $defaultPort)) 'default listener disappears at shutdown'

$guardPort = 5197
$publicProcess = Start-TestHost 'public-address-rejection' $guardPort @{
    DLE_OS_SIM_LAN_MODE = 'true'
    DLE_OS_SIM_LAN_ADDRESS = '8.8.8.8'
    DLE_OS_SIM_LAN_HOSTNAME = 'sim-invalid.dle-os.internal.dlemfg.com'
    DLE_OS_SIM_CERTIFICATE_THUMBPRINT = ('A' * 40)
    DLE_OS_SIM_ACCESS_CODE = 'INVALID1'
}
$publicProcess.WaitForExit(10000) | Out-Null
Require ($publicProcess.HasExited -and $publicProcess.ExitCode -ne 0) 'public LAN binding fails startup closed'
$publicOutput = [IO.File]::ReadAllText((Join-Path $testRoot 'public-address-rejection.stderr.log'))
Require ($publicOutput -match 'rejects loopback, public, unspecified, multicast, and non-private') 'public-address rejection is explicit'

$lanAddress = ([Net.NetworkInformation.NetworkInterface]::GetAllNetworkInterfaces() |
    Where-Object OperationalStatus -eq ([Net.NetworkInformation.OperationalStatus]::Up) |
    ForEach-Object { $_.GetIPProperties().UnicastAddresses } |
    ForEach-Object { $_.Address.ToString() } |
    Where-Object { $_ -like '10.*' -or $_ -like '192.168.*' -or $_ -match '^172\.(1[6-9]|2[0-9]|3[01])\.' } |
    Select-Object -First 1)
Require (-not [string]::IsNullOrWhiteSpace($lanAddress)) 'qualification workstation has an assigned private IPv4 address'
$qualificationHost = 'dev.dle-os.internal.dlemfg.com'
$rsa = [Security.Cryptography.RSA]::Create(2048)
$request = [Security.Cryptography.X509Certificates.CertificateRequest]::new(
    "CN=$qualificationHost", $rsa, [Security.Cryptography.HashAlgorithmName]::SHA256,
    [Security.Cryptography.RSASignaturePadding]::Pkcs1)
$san = [Security.Cryptography.X509Certificates.SubjectAlternativeNameBuilder]::new()
$san.AddDnsName($qualificationHost)
$request.CertificateExtensions.Add($san.Build())
$request.CertificateExtensions.Add([Security.Cryptography.X509Certificates.X509BasicConstraintsExtension]::new($false, $false, 0, $true))
$request.CertificateExtensions.Add([Security.Cryptography.X509Certificates.X509KeyUsageExtension]::new(
    [Security.Cryptography.X509Certificates.X509KeyUsageFlags]::DigitalSignature -bor
    [Security.Cryptography.X509Certificates.X509KeyUsageFlags]::KeyEncipherment, $true))
$oids = [Security.Cryptography.OidCollection]::new()
$null = $oids.Add([Security.Cryptography.Oid]::new('1.3.6.1.5.5.7.3.1'))
$request.CertificateExtensions.Add([Security.Cryptography.X509Certificates.X509EnhancedKeyUsageExtension]::new($oids, $true))
$temporary = $request.CreateSelfSigned((Get-Date).AddMinutes(-5), (Get-Date).AddHours(1))
$certificate = [Security.Cryptography.X509Certificates.X509Certificate2]::new(
    $temporary.Export([Security.Cryptography.X509Certificates.X509ContentType]::Pfx), '',
    [Security.Cryptography.X509Certificates.X509KeyStorageFlags]::PersistKeySet -bor
    [Security.Cryptography.X509Certificates.X509KeyStorageFlags]::UserKeySet -bor
    [Security.Cryptography.X509Certificates.X509KeyStorageFlags]::Exportable)
$certificateStore = [Security.Cryptography.X509Certificates.X509Store]::new('My', 'CurrentUser')
$certificateStore.Open([Security.Cryptography.X509Certificates.OpenFlags]::ReadWrite)
$certificateStore.Add($certificate)
$certificateStore.Close()
Require ($certificate.HasPrivateKey) 'ephemeral exact-name qualification certificate has a private key'

$lanPort = 5198
$accessCode = 'PHASE13X'
$lanProcess = $null
$client = $null
try {
    $lanProcess = Start-TestHost 'lan' $lanPort @{
        DLE_OS_SIM_LAN_MODE = 'true'
        DLE_OS_SIM_LAN_ADDRESS = $lanAddress
        DLE_OS_SIM_LAN_HOSTNAME = $qualificationHost
        DLE_OS_SIM_CERTIFICATE_THUMBPRINT = $certificate.Thumbprint
        DLE_OS_SIM_ACCESS_CODE = $accessCode
    }
    Require (Wait-Listener $lanPort $lanProcess) 'explicit LAN HTTPS listener starts'
    $listeners = @([Net.NetworkInformation.IPGlobalProperties]::GetIPGlobalProperties().GetActiveTcpListeners() |
        Where-Object Port -eq $lanPort)
    Require ($listeners.Count -eq 1 -and $listeners[0].Address.ToString() -eq $lanAddress) 'LAN listener binds only the intended private address'

    $handler = [Net.Http.SocketsHttpHandler]::new()
    $handler.UseProxy = $false
    $handler.AllowAutoRedirect = $true
    $handler.CookieContainer = [Net.CookieContainer]::new()
    $handler.ConnectCallback = [SimLanTestConnector]::Create(
        [Net.IPAddress]::Parse($lanAddress), $lanPort)
    $chainPolicy = [Security.Cryptography.X509Certificates.X509ChainPolicy]::new()
    $chainPolicy.TrustMode = [Security.Cryptography.X509Certificates.X509ChainTrustMode]::CustomRootTrust
    $chainPolicy.RevocationMode = [Security.Cryptography.X509Certificates.X509RevocationMode]::NoCheck
    $null = $chainPolicy.CustomTrustStore.Add($certificate)
    $handler.SslOptions.CertificateChainPolicy = $chainPolicy
    $client = [Net.Http.HttpClient]::new($handler)
    $client.Timeout = [TimeSpan]::FromSeconds(10)
    $origin = "https://$qualificationHost`:$lanPort"

    $unauthorized = $client.GetAsync("$origin/api/sim/status").GetAwaiter().GetResult()
    Require ([int]$unauthorized.StatusCode -eq 401) 'LAN API denies a device without a valid session'
    $invalidValues = [Collections.Generic.List[Collections.Generic.KeyValuePair[string,string]]]::new()
    $invalidValues.Add([Collections.Generic.KeyValuePair[string,string]]::new('sim_access', 'WRONGCODE'))
    $invalidBody = [Net.Http.FormUrlEncodedContent]::new($invalidValues)
    $invalid = $client.PostAsync("$origin/sim-access", $invalidBody).GetAwaiter().GetResult()
    Require ([int]$invalid.StatusCode -eq 401) 'invalid LAN access code is denied'
    $validValues = [Collections.Generic.List[Collections.Generic.KeyValuePair[string,string]]]::new()
    $validValues.Add([Collections.Generic.KeyValuePair[string,string]]::new('sim_access', $accessCode))
    $validBody = [Net.Http.FormUrlEncodedContent]::new($validValues)
    $authorized = $client.PostAsync("$origin/sim-access", $validBody).GetAwaiter().GetResult()
    Require ([int]$authorized.StatusCode -eq 200) 'valid LAN access code bootstraps an in-memory device session'
    $shell = $authorized.Content.ReadAsStringAsync().GetAwaiter().GetResult()
    Require ($shell -match 'LAN MODE' -and $shell -match [regex]::Escape($origin)) 'LAN shell visibly reports LAN MODE and its safe URL'

    $statusJson = $client.GetStringAsync("$origin/api/sim/status").GetAwaiter().GetResult() | ConvertFrom-Json
    Require ($statusJson.lanMode -and $statusJson.networkBoundary -eq 'PRIVATE_LAN_HTTPS') 'authorized runtime reports its HTTPS LAN boundary'
    $unknown = $client.GetAsync("$origin/api/platform/live/v1/readiness").GetAwaiter().GetResult()
    Require ([int]$unknown.StatusCode -eq 501) 'LAN SIM cannot bridge an unknown DEV/LIVE route'

    $tcp = [Net.Sockets.TcpClient]::new($lanAddress, $lanPort)
    $tls = [Net.Security.SslStream]::new($tcp.GetStream(), $false)
    $tlsOptions = [Net.Security.SslClientAuthenticationOptions]::new()
    $tlsOptions.TargetHost = $qualificationHost
    $tlsOptions.CertificateChainPolicy = $chainPolicy
    $tls.AuthenticateAsClient($tlsOptions)
    $writer = [IO.StreamWriter]::new($tls, [Text.Encoding]::ASCII, 1024, $true)
    $writer.NewLine = "`r`n"
    $writer.WriteLine('GET /api/sim/status HTTP/1.1')
    $writer.WriteLine('Host: unexpected.dle-os.internal.dlemfg.com')
    $writer.WriteLine('Connection: close')
    $writer.WriteLine('')
    $writer.Flush()
    $reader = [IO.StreamReader]::new($tls, [Text.Encoding]::ASCII, $false, 1024, $true)
    $statusLine = $reader.ReadLine()
    $reader.Dispose(); $writer.Dispose(); $tls.Dispose(); $tcp.Dispose()
    Require ($statusLine -match '^HTTP/1\.[01] 421 ') 'unexpected Host header is rejected'

    $runtimeMetadata = [IO.File]::ReadAllText((Join-Path $repository '.sim-state\runtime\runtime.json'))
    Require ($runtimeMetadata -notmatch [regex]::Escape($accessCode)) 'LAN access code is absent from durable runtime metadata'
}
finally {
    if ($null -ne $client) { $client.Dispose() }
    Stop-TestHost $lanProcess
    $certificateStore = [Security.Cryptography.X509Certificates.X509Store]::new('My', 'CurrentUser')
    $certificateStore.Open([Security.Cryptography.X509Certificates.OpenFlags]::ReadWrite)
    $certificateStore.Remove($certificate)
    $certificateStore.Close()
    $certificate.Dispose()
    $temporary.Dispose()
    $rsa.Dispose()
}
Require (-not ([Net.NetworkInformation.IPGlobalProperties]::GetIPGlobalProperties().GetActiveTcpListeners() |
    Where-Object Port -eq $lanPort)) 'LAN listener disappears when SIM stops'

Write-Host "PASS: $($checks.Count) DLE-OS SIM Phase 13 LAN-mode checks."
$checks | ForEach-Object { Write-Host "  - $_" }
