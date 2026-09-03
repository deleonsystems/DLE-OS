Set-StrictMode -Version Latest

function Get-DleOsSimProfilePath {
    param([string] $ProfilePath)
    if (-not [string]::IsNullOrWhiteSpace($ProfilePath)) { return $ProfilePath }
    return Join-Path $env:LOCALAPPDATA 'DLE-OS\SIM\sim-profile.json'
}

function Get-DleOsSimProfile {
    param([string] $ProfilePath)
    $resolved = Get-DleOsSimProfilePath $ProfilePath
    if (-not (Test-Path -LiteralPath $resolved -PathType Leaf)) {
        throw "SIM profile is missing: $resolved"
    }
    $profile = Get-Content -LiteralPath $resolved -Raw | ConvertFrom-Json
    foreach ($name in @('repoPath','lanIp','hostname','certificateThumbprint','url')) {
        if ([string]::IsNullOrWhiteSpace([string]$profile.$name)) {
            throw "SIM profile is missing required field: $name"
        }
    }
    $profile | Add-Member -NotePropertyName profilePath -NotePropertyValue $resolved -Force
    return $profile
}

function Get-DleOsSimGitStatus {
    param([Parameter(Mandatory)][string] $RepoPath)
    $branch = (& git -C $RepoPath branch --show-current 2>$null)
    $head = (& git -C $RepoPath rev-parse HEAD 2>$null)
    $upstream = (& git -C $RepoPath rev-parse --abbrev-ref --symbolic-full-name '@{u}' 2>$null)
    $ahead = $null
    $behind = $null
    if ($LASTEXITCODE -eq 0 -and -not [string]::IsNullOrWhiteSpace($upstream)) {
        $counts = (& git -C $RepoPath rev-list --left-right --count 'HEAD...@{u}' 2>$null)
        if ($LASTEXITCODE -eq 0 -and $counts -match '^\s*(\d+)\s+(\d+)\s*$') {
            $ahead = [int]$Matches[1]
            $behind = [int]$Matches[2]
        }
    }
    $statusLines = @(& git -C $RepoPath status --short --untracked-files=all 2>$null)
    [pscustomobject]@{
        branch = [string]$branch
        head = [string]$head
        upstream = [string]$upstream
        ahead = $ahead
        behind = $behind
        clean = $statusLines.Count -eq 0
        changes = $statusLines
    }
}

function Get-DleOsSimTcpListener {
    param(
        [Parameter(Mandatory)][string] $LocalAddress,
        [int] $Port = 5177
    )
    $netstatListeners = @()
    try {
        $netstatListeners = @(netstat -ano -p tcp 2>$null |
            ForEach-Object {
                $line = [string]$_
                if ($line -match '^\s*TCP\s+(\S+):(\d+)\s+\S+\s+LISTENING\s+(\d+)\s*$') {
                    [pscustomobject]@{
                        localAddress = $Matches[1]
                        localPort = [int]$Matches[2]
                        owningProcess = [int]$Matches[3]
                        source = 'netstat'
                    }
                }
            } |
            Where-Object { $_.localPort -eq $Port -and $_.localAddress -eq $LocalAddress })
    }
    catch {
        $netstatListeners = @()
    }
    if (@($netstatListeners).Count -gt 0) { return $netstatListeners }

    $listeners = @()
    try {
        $listeners = [Net.NetworkInformation.IPGlobalProperties]::GetIPGlobalProperties().
            GetActiveTcpListeners() |
            Where-Object { $_.Port -eq $Port -and $_.Address.ToString() -eq $LocalAddress } |
            ForEach-Object {
                [pscustomobject]@{
                    localAddress = $_.Address.ToString()
                    localPort = $_.Port
                    source = 'IPGlobalProperties'
                }
            }
    }
    catch {
        $listeners = @()
    }
    if (@($listeners).Count -gt 0) { return $listeners }

    return @(Get-NetTCPConnection -LocalPort $Port -ErrorAction SilentlyContinue |
        Where-Object { $_.State -eq 'Listen' -and $_.LocalAddress -eq $LocalAddress } |
        ForEach-Object {
            [pscustomobject]@{
                localAddress = $_.LocalAddress
                localPort = $_.LocalPort
                owningProcess = $_.OwningProcess
                source = 'Get-NetTCPConnection'
            }
        })
}

function Test-DleOsSimCertificate {
    param(
        [Parameter(Mandatory)][string] $Thumbprint,
        [Parameter(Mandatory)][string] $Hostname
    )
    $normalized = ($Thumbprint -replace '\s','').ToUpperInvariant()
    $matches = @()
    foreach ($location in 'CurrentUser','LocalMachine') {
        $store = [Security.Cryptography.X509Certificates.X509Store]::new('My', $location)
        try {
            $store.Open([Security.Cryptography.X509Certificates.OpenFlags]::ReadOnly)
            $matches += $store.Certificates.Find(
                [Security.Cryptography.X509Certificates.X509FindType]::FindByThumbprint,
                $normalized,
                $false
            ) | ForEach-Object {
                $san = $_.Extensions |
                    Where-Object { $_.Oid.FriendlyName -eq 'Subject Alternative Name' } |
                    ForEach-Object { $_.Format($true) }
                [pscustomobject]@{
                    store = "$location\My"
                    thumbprint = $_.Thumbprint
                    subject = $_.Subject
                    issuer = $_.Issuer
                    notBefore = $_.NotBefore
                    notAfter = $_.NotAfter
                    hasPrivateKey = $_.HasPrivateKey
                    san = [string]$san
                    hostnameMatches = ([string]$san -match [regex]::Escape($Hostname))
                }
            }
        }
        finally {
            $store.Close()
        }
    }
    $selected = $matches | Where-Object hostnameMatches | Select-Object -First 1
    if ($null -eq $selected) { $selected = $matches | Select-Object -First 1 }
    [pscustomobject]@{
        found = $null -ne $selected
        readable = $null -ne $selected -and [bool]$selected.hasPrivateKey
        selected = $selected
        matches = $matches
    }
}

function Get-DleOsSimFirewallStatus {
    param([Parameter(Mandatory)] $Profile)
    $rule = Get-NetFirewallRule -ErrorAction SilentlyContinue |
        Where-Object { $_.DisplayName -eq $Profile.firewallRuleName } |
        Select-Object -First 1
    if ($null -eq $rule) {
        $netshLines = @(netsh advfirewall firewall show rule name="$($Profile.firewallRuleName)" verbose 2>$null)
        $text = $netshLines -join "`n"
        if ($LASTEXITCODE -ne 0 -or $text -match 'No rules match') {
            return [pscustomobject]@{ found = $false; ready = $false; ruleName = $Profile.firewallRuleName }
        }
        $fields = @{}
        foreach ($line in $netshLines) {
            if ($line -match '^\s*([^:]+):\s*(.*?)\s*$') {
                $fields[$Matches[1].Trim()] = $Matches[2].Trim()
            }
        }
        $ready = $fields['Enabled'] -eq 'Yes' -and
            $fields['Profiles'] -match 'Private' -and
            $fields['Direction'] -eq 'In' -and
            $fields['Action'] -eq 'Allow' -and
            $fields['Protocol'] -eq 'TCP' -and
            $fields['LocalPort'] -eq '5177' -and
            $fields['LocalIP'] -match [regex]::Escape([string]$Profile.lanIp) -and
            $fields['RemoteIP'] -ne 'Any'
        return [pscustomobject]@{
            found = $true
            ready = $ready
            ruleName = $Profile.firewallRuleName
            enabled = $fields['Enabled']
            profile = $fields['Profiles']
            direction = $fields['Direction']
            action = $fields['Action']
            localPort = $fields['LocalPort']
            localAddress = $fields['LocalIP']
            remoteAddress = $fields['RemoteIP']
            program = $fields['Program']
            source = 'netsh'
        }
    }
    $ports = $rule | Get-NetFirewallPortFilter
    $addresses = $rule | Get-NetFirewallAddressFilter
    $ready = [string]$rule.Enabled -eq 'True' -and
        [string]$rule.Profile -match 'Private' -and
        $ports.Protocol -eq 'TCP' -and
        [string]$ports.LocalPort -eq '5177' -and
        [string]$addresses.LocalAddress -match [regex]::Escape([string]$Profile.lanIp) -and
        [string]$addresses.RemoteAddress -ne 'Any'
    [pscustomobject]@{
        found = $true
        ready = $ready
        ruleName = $rule.DisplayName
        enabled = [string]$rule.Enabled
        profile = [string]$rule.Profile
        localPort = [string]$ports.LocalPort
        localAddress = [string]$addresses.LocalAddress
        remoteAddress = [string]$addresses.RemoteAddress
        program = [string]($rule | Get-NetFirewallApplicationFilter).Program
    }
}

function Get-DleOsSimRuntimeStatus {
    param([Parameter(Mandatory)] $Profile)
    $runtimePath = Join-Path $Profile.repoPath '.sim-state\runtime\runtime.json'
    $runtime = $null
    if (Test-Path -LiteralPath $runtimePath -PathType Leaf) {
        $runtime = Get-Content -LiteralPath $runtimePath -Raw | ConvertFrom-Json
    }
    $listener = @(Get-DleOsSimTcpListener -LocalAddress $Profile.lanIp -Port 5177) | Select-Object -First 1
    $metadataMatchesProfile = $runtime -and
        $runtime.environment -eq 'SIM' -and
        $runtime.networkBoundary -eq 'PRIVATE_LAN_HTTPS' -and
        $runtime.binding -eq $Profile.url -and
        $runtime.lanHostName -eq $Profile.hostname
    $metadataPid = if ($runtime -and $runtime.processId) { [int]$runtime.processId } else { $null }
    $listenerPid = if ($listener -and $listener.owningProcess) { [int]$listener.owningProcess } else { $null }
    $pidValue = if ($metadataMatchesProfile -and $metadataPid) { $metadataPid } elseif ($listenerPid) { $listenerPid } else { $metadataPid }
    $process = if ($pidValue) { Get-Process -Id $pidValue -ErrorAction SilentlyContinue } else { $null }
    $activeBinding = if ($metadataMatchesProfile) { $runtime.binding } elseif ($listener) { $Profile.url } elseif ($runtime) { $runtime.binding } else { $null }
    [pscustomobject]@{
        running = $null -ne $process -and $null -ne $listener
        processId = $pidValue
        processName = if ($process) { $process.ProcessName } else { $null }
        binding = $activeBinding
        environment = if ($runtime) { $runtime.environment } else { $null }
        networkBoundary = if ($runtime) { $runtime.networkBoundary } else { $null }
        hostname = if ($runtime) { $runtime.lanHostName } else { $Profile.hostname }
        localAddress = if ($listener) { $listener.localAddress } else { $null }
        port = 5177
        runtimeMetadataPath = $runtimePath
    }
}

function Get-DleOsSimStatus {
    param([string] $ProfilePath)
    $profile = Get-DleOsSimProfile $ProfilePath
    $stateRoot = Join-Path $profile.repoPath '.sim-state'
    $metadataPath = Join-Path $stateRoot 'state\metadata.json'
    $stateMetadata = if (Test-Path -LiteralPath $metadataPath -PathType Leaf) {
        Get-Content -LiteralPath $metadataPath -Raw | ConvertFrom-Json
    } else { $null }
    $permanentCode = [Environment]::GetEnvironmentVariable(
        'DLE_OS_SIM_PERMANENT_ACCESS_CODE',
        [EnvironmentVariableTarget]::User)
    $startStatusPath = Join-Path (Split-Path -Parent $profile.profilePath) 'start-status.json'
    $latestStartStatus = if (Test-Path -LiteralPath $startStatusPath) {
        Get-Content -LiteralPath $startStatusPath -Raw | ConvertFrom-Json
    } else { $null }
    $currentUserHasAccessCode = -not [string]::IsNullOrWhiteSpace($permanentCode)
    $latestStartUsedAccessCode = $latestStartStatus -and $latestStartStatus.usesUserConfiguredCode
    [pscustomobject]@{
        profile = [pscustomobject]@{
            path = $profile.profilePath
            repoPath = $profile.repoPath
            lanIp = $profile.lanIp
            hostname = $profile.hostname
            url = $profile.url
            developerIdentity = $profile.developerIdentity
        }
        runtime = Get-DleOsSimRuntimeStatus $profile
        git = Get-DleOsSimGitStatus $profile.repoPath
        accessCodeConfigured = [bool]($currentUserHasAccessCode -or $latestStartUsedAccessCode)
        accessCodeConfiguredSource = if ($currentUserHasAccessCode) { 'current-user-env' } elseif ($latestStartUsedAccessCode) { 'latest-start-status' } else { $null }
        certificate = Test-DleOsSimCertificate $profile.certificateThumbprint $profile.hostname
        firewall = Get-DleOsSimFirewallStatus $profile
        state = [pscustomobject]@{
            stateRootPresent = Test-Path -LiteralPath $stateRoot
            sqlitePresent = Test-Path -LiteralPath (Join-Path $stateRoot 'data\dle-os-sim.db')
            metadataPresent = $null -ne $stateMetadata
            scenarioId = if ($stateMetadata) { $stateMetadata.scenarioId } else { $null }
            scenarioVersion = if ($stateMetadata) { $stateMetadata.scenarioVersion } else { $null }
            generation = if ($stateMetadata) { $stateMetadata.generation } else { $null }
        }
        latestStartStatus = $latestStartStatus
    }
}

function Test-DleOsSimPreflight {
    param([string] $ProfilePath)
    $profile = Get-DleOsSimProfile $ProfilePath
    $checks = [Collections.Generic.List[object]]::new()
    function Add-Check([string]$Name, [bool]$Passed, [string]$Message) {
        $checks.Add([pscustomobject]@{ name = $Name; passed = $Passed; message = $Message })
    }
    Add-Check 'repo' (Test-Path -LiteralPath $profile.repoPath -PathType Container) $profile.repoPath
    Add-Check 'pwsh' (Test-Path -LiteralPath 'C:\Program Files\PowerShell\7\pwsh.exe') 'PowerShell 7 path'
    Add-Check 'dotnet' (-not [string]::IsNullOrWhiteSpace((Get-Command dotnet -ErrorAction SilentlyContinue).Source)) '.NET command on PATH'
    $permanentCode = [Environment]::GetEnvironmentVariable('DLE_OS_SIM_PERMANENT_ACCESS_CODE', [EnvironmentVariableTarget]::User)
    Add-Check 'permanentAccessCode' (-not [string]::IsNullOrWhiteSpace($permanentCode)) 'DLE_OS_SIM_PERMANENT_ACCESS_CODE present in User scope'
    $resolved = @(Resolve-DnsName $profile.hostname -Type A -ErrorAction SilentlyContinue | Where-Object Type -eq A | Select-Object -ExpandProperty IPAddress -Unique)
    Add-Check 'dns' ($profile.lanIp -in $resolved) "$($profile.hostname) resolves to $($profile.lanIp)"
    $cert = Test-DleOsSimCertificate $profile.certificateThumbprint $profile.hostname
    Add-Check 'certificate' ($cert.found -and $cert.readable -and $cert.selected.hostnameMatches) 'certificate present, SAN-matched, private key available'
    $firewall = Get-DleOsSimFirewallStatus $profile
    Add-Check 'firewall' $firewall.ready 'private scoped TCP 5177 firewall rule'
    $listener = @(Get-DleOsSimTcpListener -LocalAddress $profile.lanIp -Port 5177)
    $runtime = Get-DleOsSimRuntimeStatus $profile
    Add-Check 'port5177' ($listener.Count -eq 0 -or ($runtime.running -and $runtime.binding -eq $profile.url)) 'port 5177 free or already owned by this SIM'
    Add-Check 'runtimeConflict' (-not ($listener.Count -gt 0 -and -not $runtime.running)) 'no unrelated SIM listener'
    [pscustomobject]@{
        passed = -not ($checks | Where-Object { -not $_.passed })
        checks = $checks
    }
}

function Stop-DleOsSimSafely {
    param([string] $ProfilePath)
    $profile = Get-DleOsSimProfile $ProfilePath
    $statePath = Join-Path $profile.repoPath '.sim-state\runtime\runtime.json'
    if (-not (Test-Path -LiteralPath $statePath -PathType Leaf)) {
        return [pscustomobject]@{ result = 'stopped'; message = 'No SIM runtime metadata found.' }
    }
    $runtime = Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json
    $runtimeStatus = Get-DleOsSimRuntimeStatus $profile
    if ($runtime.environment -ne 'SIM' -or
        $runtime.networkBoundary -ne 'PRIVATE_LAN_HTTPS' -or
        $runtime.binding -ne $profile.url -or
        $runtime.lanHostName -ne $profile.hostname) {
        if (-not ($runtimeStatus.running -and $runtimeStatus.binding -eq $profile.url)) {
            throw 'Runtime metadata does not identify the configured SIM LAN host. Refusing to stop anything.'
        }
    }
    $pidValue = if ($runtimeStatus.running -and $runtimeStatus.processId) { [int]$runtimeStatus.processId } else { [int]$runtime.processId }
    $process = Get-CimInstance Win32_Process -Filter "ProcessId=$pidValue" -ErrorAction SilentlyContinue
    if ($null -eq $process) {
        return [pscustomobject]@{ result = 'stopped'; processId = $pidValue; message = 'Recorded SIM process is not running.' }
    }
    $expectedRoot = Join-Path $profile.repoPath 'Tools\SimRuntime\DleOs.SimHost'
    $commandLine = [string]$process.CommandLine
    $executable = [string]$process.ExecutablePath
    if ($commandLine -notlike "*$expectedRoot*" -and $executable -notlike "*$expectedRoot*") {
        throw "Process $pidValue does not match the DLE-OS SIM host path. Refusing to stop it."
    }
    Stop-Process -Id $pidValue -Force
    for ($attempt = 0; $attempt -lt 30; $attempt++) {
        Start-Sleep -Milliseconds 250
        $listener = @(Get-DleOsSimTcpListener -LocalAddress $profile.lanIp -Port 5177)
        if (-not $listener) {
            return [pscustomobject]@{ result = 'stopped'; processId = $pidValue; message = 'Port 5177 is no longer listening.' }
        }
    }
    throw 'DLE-OS SIM stop was requested, but port 5177 still appears reachable.'
}

Export-ModuleMember -Function *-DleOsSim*,Stop-DleOsSimSafely
