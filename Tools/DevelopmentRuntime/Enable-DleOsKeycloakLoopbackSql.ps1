[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$instanceService = 'MSSQL$SQLEXPRESS'
$browserService = 'SQLBrowser'
$tcpRoot = 'HKLM:\SOFTWARE\Microsoft\Microsoft SQL Server\MSSQL16.SQLEXPRESS\MSSQLServer\SuperSocketNetLib\Tcp'
$loopbackAddress = '127.0.0.1'
$lanAddress = '192.168.0.105'
$staticPort = 14330
$evidencePath = 'C:\ProgramData\DLE-OS\Keycloak\State\loopback-sql.json'
$previousEvidencePath = 'C:\ProgramData\DLE-OS\Keycloak\State\loopback-sql.previous.json'
$protectedPorts = 5041,5042,5043,5052,5053
$consumerUris = @(
    'http://DLE-OS-HOST:5041/api/platform/v1/readiness',
    'http://DLE-OS-HOST:5042/api/platform/live/v1/readiness',
    'http://dle-os-host:5043/health',
    'http://DLE-OS-HOST:5052/api/platform/live/v1/readiness',
    'http://dle-os-host:5053/health',
    'http://DLE-OS-HOST:5054/health',
    'http://dle-os-host:5051/shared'
)

function Test-IsAdministrator {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = [Security.Principal.WindowsPrincipal]::new($identity)
    return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Get-ListenerPid([int]$Port) {
    $line = netstat.exe -ano -p tcp |
        Select-String -Pattern (':' + $Port + '\s+.*LISTENING\s+\d+$') |
        Select-Object -First 1
    if (-not $line) { return $null }
    return [int]((-split $line.Line)[-1])
}

function Get-ProtectedSnapshot {
    $snapshot = [ordered]@{}
    foreach ($port in $protectedPorts) { $snapshot[[string]$port] = Get-ListenerPid $port }
    return $snapshot
}

function Get-HttpStatus([string]$Uri) {
    try {
        $request = [Net.HttpWebRequest]::Create($Uri)
        $request.UseDefaultCredentials = $true
        $request.Timeout = 15000
        $response = $request.GetResponse()
        try { return [int]$response.StatusCode }
        finally { $response.Dispose() }
    }
    catch [Net.WebException] {
        if ($_.Exception.Response) {
            try { return [int]$_.Exception.Response.StatusCode }
            finally { $_.Exception.Response.Dispose() }
        }
        throw "No HTTP response from $($Uri): $($_.Exception.Message)"
    }
}

function Get-ConsumerSnapshot {
    $snapshot = [ordered]@{}
    foreach ($uri in $consumerUris) { $snapshot[$uri] = Get-HttpStatus $uri }
    return $snapshot
}

function Get-SqlServiceSnapshot {
    $service = Get-CimInstance Win32_Service -Filter "Name='$instanceService'"
    return [ordered]@{State=$service.State;StartMode=$service.StartMode;ProcessId=[int]$service.ProcessId}
}

function Get-FirewallSnapshot {
    return @(Get-NetFirewallPortFilter -PolicyStore ActiveStore -ErrorAction Stop |
        Where-Object { $_.Protocol -eq 'TCP' -and [string]$_.LocalPort -eq [string]$staticPort } |
        Sort-Object InstanceID |
        ForEach-Object { [ordered]@{InstanceID=$_.InstanceID;Protocol=[string]$_.Protocol;LocalPort=[string]$_.LocalPort} })
}

if (-not (Test-IsAdministrator)) {
    $arguments = @('-NoLogo','-NoProfile','-ExecutionPolicy','Bypass','-File',('"{0}"' -f $PSCommandPath))
    $process = Start-Process powershell.exe -Verb RunAs -ArgumentList $arguments -Wait -PassThru
    exit $process.ExitCode
}
if (-not (Test-Path -LiteralPath $tcpRoot)) { throw 'The SQL Server 2022 SQLEXPRESS TCP configuration was not found.' }
if (Test-Path -LiteralPath $evidencePath) {
    Copy-Item -LiteralPath $evidencePath -Destination $previousEvidencePath -Force
}

$evidence = [ordered]@{
    Verdict = 'FAIL'
    StartedAtUtc = [DateTimeOffset]::UtcNow.ToString('o')
    Identity = [Security.Principal.WindowsIdentity]::GetCurrent().Name
    StaticPort = $staticPort
    LoopbackAddress = $loopbackAddress
    LanAddress = $lanAddress
}

try {
    $evidence.SqlBefore = Get-SqlServiceSnapshot
    if ($evidence.SqlBefore.State -ne 'Running') { throw 'SQLEXPRESS is not running before the controlled restart.' }
    $evidence.ProtectedBefore = Get-ProtectedSnapshot
    if (@($evidence.ProtectedBefore.Values | Where-Object { $null -eq $_ }).Count -ne 0) {
        throw 'A protected production listener is absent before the SQL restart.'
    }
    $evidence.ConsumersBefore = Get-ConsumerSnapshot
    $firewallBefore = Get-FirewallSnapshot
    $evidence.FirewallFiltersBefore = $firewallBefore
    $browserBefore = Get-Service -Name $browserService
    $evidence.SqlBrowserBefore = [ordered]@{Status=[string]$browserBefore.Status;StartType=[string]$browserBefore.StartType}
    if ($browserBefore.Status -ne 'Stopped' -or $browserBefore.StartType -ne 'Disabled') {
        throw 'SQL Browser is not in the approved stopped/disabled baseline.'
    }

    $tcp = Get-ItemProperty -LiteralPath $tcpRoot
    $ipConfiguration = [ordered]@{}
    $loopbackKey = $null
    foreach ($key in Get-ChildItem -LiteralPath $tcpRoot | Where-Object PSChildName -Like 'IP*') {
        $properties = Get-ItemProperty -LiteralPath $key.PSPath
        $configuredAddress = if ($key.PSChildName -eq 'IPAll') { $null } else { [string]$properties.IpAddress }
        $configuredEnabled = if ($key.PSChildName -eq 'IPAll') { $null } else { [int]$properties.Enabled }
        $ipConfiguration[$key.PSChildName] = [ordered]@{
            IpAddress=$configuredAddress;Enabled=$configuredEnabled;
            TcpDynamicPorts=$properties.TcpDynamicPorts;TcpPort=$properties.TcpPort
        }
        if ($configuredAddress -eq $loopbackAddress) { $loopbackKey = $key.PSPath }
    }
    if (-not $loopbackKey) { throw 'The SQL TCP configuration has no exact IPv4 loopback entry.' }
    $evidence.ConfigurationBefore = [ordered]@{
        Enabled=$tcp.Enabled;ListenOnAllIPs=$tcp.ListenOnAllIPs;Addresses=$ipConfiguration
    }

    $configurationExact = ([int]$tcp.Enabled -eq 1 -and [int]$tcp.ListenOnAllIPs -eq 0)
    foreach ($entry in $ipConfiguration.GetEnumerator()) {
        if ($entry.Key -eq 'IPAll') {
            $configurationExact = $configurationExact -and
                [string]::IsNullOrEmpty([string]$entry.Value.TcpDynamicPorts) -and
                [string]::IsNullOrEmpty([string]$entry.Value.TcpPort)
        }
        elseif ($entry.Value.IpAddress -eq $loopbackAddress) {
            $configurationExact = $configurationExact -and [int]$entry.Value.Enabled -eq 1 -and
                [string]::IsNullOrEmpty([string]$entry.Value.TcpDynamicPorts) -and
                [string]$entry.Value.TcpPort -eq [string]$staticPort
        }
        else {
            $configurationExact = $configurationExact -and [int]$entry.Value.Enabled -eq 0
        }
    }

    $restartCount = 0
    if (-not $configurationExact) {
        Set-ItemProperty -LiteralPath $tcpRoot -Name Enabled -Type DWord -Value 1
        Set-ItemProperty -LiteralPath $tcpRoot -Name ListenOnAllIPs -Type DWord -Value 0
        foreach ($key in Get-ChildItem -LiteralPath $tcpRoot | Where-Object PSChildName -Like 'IP*') {
            if ($key.PSChildName -eq 'IPAll') {
                Set-ItemProperty -LiteralPath $key.PSPath -Name TcpDynamicPorts -Value ''
                Set-ItemProperty -LiteralPath $key.PSPath -Name TcpPort -Value ''
                continue
            }
            Set-ItemProperty -LiteralPath $key.PSPath -Name Enabled -Type DWord -Value 0
        }
        Set-ItemProperty -LiteralPath $loopbackKey -Name Enabled -Type DWord -Value 1
        Set-ItemProperty -LiteralPath $loopbackKey -Name TcpDynamicPorts -Value ''
        Set-ItemProperty -LiteralPath $loopbackKey -Name TcpPort -Value ([string]$staticPort)
        Restart-Service -Name $instanceService -Force
        $restartCount = 1
    }
    $deadline = [DateTimeOffset]::UtcNow.AddSeconds(90)
    do {
        Start-Sleep -Milliseconds 500
        $sqlService = Get-Service -Name $instanceService
        $loopbackListener = @(Get-NetTCPConnection -State Listen -LocalPort $staticPort -ErrorAction SilentlyContinue |
            Where-Object LocalAddress -eq $loopbackAddress)
    } while (($sqlService.Status -ne 'Running' -or $loopbackListener.Count -ne 1) -and
             [DateTimeOffset]::UtcNow -lt $deadline)
    if ($sqlService.Status -ne 'Running' -or $loopbackListener.Count -ne 1) {
        throw 'SQLEXPRESS did not recover on the approved IPv4 loopback port.'
    }
    $unexpectedListeners = @(Get-NetTCPConnection -State Listen -LocalPort $staticPort |
        Where-Object LocalAddress -ne $loopbackAddress)
    if ($unexpectedListeners.Count -ne 0) {
        throw 'SQL is listening on an address other than the approved IPv4 loopback address.'
    }

    $connection = [System.Data.SqlClient.SqlConnection]::new(
        "Server=tcp:$loopbackAddress,$staticPort;Database=master;Integrated Security=True;Encrypt=False;TrustServerCertificate=True")
    try {
        $connection.Open()
        $command = $connection.CreateCommand()
        try {
            $command.CommandText = 'SELECT 1'
            if ([int]$command.ExecuteScalar() -ne 1) { throw 'The loopback SQL transport check returned an invalid result.' }
        }
        finally { $command.Dispose() }
    }
    finally { $connection.Dispose() }

    $consumerDeadline = [DateTimeOffset]::UtcNow.AddSeconds(60)
    do {
        try {
            $consumersAfter = Get-ConsumerSnapshot
            $consumerMatch = (($evidence.ConsumersBefore | ConvertTo-Json -Compress) -eq
                              ($consumersAfter | ConvertTo-Json -Compress))
        }
        catch { $consumerMatch = $false }
        if (-not $consumerMatch) { Start-Sleep -Seconds 2 }
    } while (-not $consumerMatch -and [DateTimeOffset]::UtcNow -lt $consumerDeadline)
    if (-not $consumerMatch) { throw 'An existing DLE-OS SQL consumer did not recover to its baseline HTTP state.' }

    $evidence.ConsumersAfter = $consumersAfter
    $evidence.ProtectedAfter = Get-ProtectedSnapshot
    if (($evidence.ProtectedBefore | ConvertTo-Json -Compress) -ne
        ($evidence.ProtectedAfter | ConvertTo-Json -Compress)) {
        throw 'A protected production listener PID changed during the controlled SQL restart.'
    }
    $browserAfter = Get-Service -Name $browserService
    if ($browserAfter.Status -ne 'Stopped' -or $browserAfter.StartType -ne 'Disabled') {
        throw 'SQL Browser changed during the controlled SQL restart.'
    }
    $evidence.SqlAfter = Get-SqlServiceSnapshot
    $evidence.SqlBrowserAfter = [ordered]@{Status=[string]$browserAfter.Status;StartType=[string]$browserAfter.StartType}
    $firewallAfter = Get-FirewallSnapshot
    $evidence.FirewallFiltersAfter = $firewallAfter
    if (($firewallBefore | ConvertTo-Json -Compress) -ne ($firewallAfter | ConvertTo-Json -Compress)) {
        throw 'The TCP 14330 firewall policy changed during loopback SQL configuration.'
    }
    $evidence.LoopbackListener = "$loopbackAddress`:$staticPort"
    $evidence.LanListener = $false
    $evidence.FirewallChanged = $false
    $evidence.RestartCount = $restartCount
    $evidence.Verdict = 'PASS'
}
catch {
    $evidence.Error = $_.Exception.Message
    throw
}
finally {
    $evidence.CompletedAtUtc = [DateTimeOffset]::UtcNow.ToString('o')
    $evidence | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath $evidencePath -Encoding UTF8
}

[pscustomobject]$evidence
