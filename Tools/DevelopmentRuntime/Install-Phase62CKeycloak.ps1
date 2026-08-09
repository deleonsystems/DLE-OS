[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$repository = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')).Path
$phaseRoot = 'C:\ProgramData\DLE-OS\Keycloak'
$secretRoot = Join-Path $phaseRoot 'Secrets'
$stateRoot = Join-Path $phaseRoot 'State'
$logRoot = Join-Path $phaseRoot 'Logs'
$dataRoot = Join-Path $phaseRoot 'Data'
$backupRoot = Join-Path $phaseRoot 'Backups'
$packageRoot = Join-Path $phaseRoot 'Packages'
$scriptRoot = Join-Path $phaseRoot 'Scripts'
$deployRoot = Join-Path $phaseRoot 'Deploy'
$bootstrapMarker = Join-Path $stateRoot 'bootstrap-complete.json'
$keycloakHome = 'C:\Program Files\DLE-OS\Keycloak\current'
$javaHome = 'C:\Program Files\DLE-OS\Java\jdk-21'
$keycloakVersion = '26.7.1'
$keycloakUrl = "https://github.com/keycloak/keycloak/releases/download/$keycloakVersion/keycloak-$keycloakVersion.zip"
$keycloakSha256 = '2A67BB5773B6BB027461F485241379AC93DCFE353FFC1911F8B7BA7206C88B33'
$javaVersion = '21.0.12'
$javaUrl = "https://aka.ms/download-jdk/microsoft-jdk-$javaVersion-windows-x64.zip"
$javaSha256 = 'BF27A5D6298C736AF8DAF5B8C883098E83291446E5766118D8A5EA6A2617195D'
$jdbcAuthVersion = '13.2.1'
$jdbcAuthUrl = "https://repo1.maven.org/maven2/com/microsoft/sqlserver/mssql-jdbc_auth/$jdbcAuthVersion.x64/mssql-jdbc_auth-$jdbcAuthVersion.x64.dll"
$jdbcAuthSha256 = 'CFF95E137532224B00C15E877CE6968C58B1D7AED6911E24CE0AA91AB3AF029A'
$daemonVersion = '1.6.1'
$daemonUrl = "https://dlcdn.apache.org/commons/daemon/binaries/windows/commons-daemon-$daemonVersion-bin-windows.zip"
$daemonSha512 = 'A878177EDC92E663C1113858F8903451EC02B5B033BCA373BEA4F8761D9196323771301FCD6A7B8387D8E2300F7A1056B9E08E83FCA9703DF32AC3ECD5B129F7'
$serviceName = 'DleOsKeycloak'
$serviceIdentity = 'NT SERVICE\DleOsKeycloak'
$frontendIdentity = 'DLE-OS-HOST\DLE-OS'
$frontendTask = 'DLE-OS Development Authenticated Frontend 5051'
$authHostname = 'auth.internal.dlemfg.com'
$appHostname = 'dle-os.internal.dlemfg.com'
$resultPath = Join-Path $phaseRoot 'phase62c-installation.json'
$protectedPorts = 5041,5042,5043,5052,5053

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

function Get-ListenerPid([int]$Port) {
    $line = netstat.exe -ano -p tcp |
        Select-String -Pattern (':' + $Port + '\s+.*LISTENING\s+\d+$') |
        Select-Object -First 1
    if (-not $line) { return $null }
    return [int]((-split $line.Line)[-1])
}

function Get-ProtectedSnapshot {
    $result = [ordered]@{}
    foreach ($port in $protectedPorts) { $result[[string]$port] = Get-ListenerPid $port }
    return $result
}

function Unprotect-Secret {
    param([string]$Name, [string]$EntropyText)
    Add-Type -AssemblyName System.Security
    $protectedBytes = $null
    $entropyBytes = $null
    $plainBytes = $null
    try {
        $protectedBytes = [IO.File]::ReadAllBytes((Join-Path $secretRoot "$Name.dpapi"))
        $entropyBytes = [Text.Encoding]::UTF8.GetBytes($EntropyText)
        $plainBytes = [Security.Cryptography.ProtectedData]::Unprotect(
            $protectedBytes,
            $entropyBytes,
            [Security.Cryptography.DataProtectionScope]::LocalMachine)
        if ($plainBytes.Length -eq 0) { throw "Protected secret $Name is empty." }
        return [Text.Encoding]::UTF8.GetString($plainBytes)
    }
    finally {
        if ($plainBytes) { [Array]::Clear($plainBytes, 0, $plainBytes.Length) }
        if ($entropyBytes) { [Array]::Clear($entropyBytes, 0, $entropyBytes.Length) }
        if ($protectedBytes) { [Array]::Clear($protectedBytes, 0, $protectedBytes.Length) }
    }
}

function Invoke-Download {
    param([string]$Uri, [string]$Destination)
    if (-not (Test-Path -LiteralPath $Destination)) {
        Invoke-WebRequest -UseBasicParsing -Uri $Uri -OutFile $Destination
    }
}

function Assert-PinnedHash {
    param(
        [string]$Path,
        [ValidateSet('SHA256','SHA512')][string]$Algorithm,
        [string]$ExpectedHash
    )
    $actual = (Get-FileHash -LiteralPath $Path -Algorithm $Algorithm).Hash
    if ($actual -ine $ExpectedHash) { throw "$Algorithm checksum failed for $Path." }
    return $actual
}

function Copy-FileIfChanged {
    param([string]$Source, [string]$Destination, [int]$RetrySeconds=30)
    $sourceHash = (Get-FileHash -LiteralPath $Source -Algorithm SHA256).Hash
    if ((Test-Path -LiteralPath $Destination) -and
        (Get-FileHash -LiteralPath $Destination -Algorithm SHA256).Hash -ieq $sourceHash) {
        return
    }

    $deadline = [DateTimeOffset]::UtcNow.AddSeconds($RetrySeconds)
    $lastError = $null
    do {
        try {
            Copy-Item -LiteralPath $Source -Destination $Destination -Force
            if ((Get-FileHash -LiteralPath $Destination -Algorithm SHA256).Hash -ine $sourceHash) {
                throw "The copied file hash does not match $Source."
            }
            return
        }
        catch {
            $lastError = $_
            Start-Sleep -Milliseconds 500
        }
    } while ([DateTimeOffset]::UtcNow -lt $deadline)

    throw "Unable to deploy $Destination within $RetrySeconds seconds: $($lastError.Exception.Message)"
}

function Set-GovernedDirectoryAcl {
    param([string]$Path, [string[]]$ReadExecuteIdentities=@(), [string[]]$ModifyIdentities=@())
    & icacls.exe $Path '/inheritance:r' '/grant:r' `
        'NT AUTHORITY\SYSTEM:(OI)(CI)F' 'BUILTIN\Administrators:(OI)(CI)F' | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "Failed to protect $Path." }
    foreach ($identity in $ReadExecuteIdentities) {
        & icacls.exe $Path '/grant' "${identity}:(OI)(CI)RX" | Out-Null
        if ($LASTEXITCODE -ne 0) { throw "Failed to grant read access to $identity on $Path." }
    }
    foreach ($identity in $ModifyIdentities) {
        & icacls.exe $Path '/grant' "${identity}:(OI)(CI)M" | Out-Null
        if ($LASTEXITCODE -ne 0) { throw "Failed to grant modify access to $identity on $Path." }
    }
}

function Grant-ExactFileRead {
    param([string]$Path, [string]$Identity)
    $grants = @('NT AUTHORITY\SYSTEM:F', 'BUILTIN\Administrators:F')
    if ($Identity -inotmatch '^(NT AUTHORITY\\SYSTEM|BUILTIN\\Administrators)$') {
        $grants += "${Identity}:R"
    }
    & icacls.exe $Path '/inheritance:r' '/grant:r' @grants | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "Failed to grant governed file access on $Path." }
}

function Invoke-SqlBatch {
    param(
        [string]$Database,
        [string]$Sql,
        [hashtable]$Parameters=@{}
    )
    $connection = [System.Data.SqlClient.SqlConnection]::new(
        "Server=lpc:.\SQLEXPRESS;Database=$Database;Integrated Security=True;Encrypt=False;TrustServerCertificate=True")
    try {
        $connection.Open()
        foreach ($batch in [regex]::Split($Sql, '(?im)^\s*GO\s*$')) {
            if ([string]::IsNullOrWhiteSpace($batch)) { continue }
            $command = $connection.CreateCommand()
            try {
                $command.CommandText = $batch
                $command.CommandTimeout = 180
                foreach ($key in $Parameters.Keys) {
                    [void]$command.Parameters.AddWithValue("@$key", $Parameters[$key])
                }
                [void]$command.ExecuteNonQuery()
            }
            finally { $command.Dispose() }
        }
    }
    finally { $connection.Dispose() }
}

function Invoke-KeycloakRequest {
    param(
        [ValidateSet('GET','POST','PUT','DELETE')][string]$Method,
        [string]$Path,
        [hashtable]$Headers,
        $Body=$null
    )
    $parameters = @{
        UseBasicParsing = $true
        Method = $Method
        Uri = "http://127.0.0.1:8180$Path"
        Headers = $Headers
    }
    if ($null -ne $Body) {
        $parameters.ContentType = 'application/json'
        $parameters.Body = $Body | ConvertTo-Json -Depth 12 -Compress
    }
    return Invoke-WebRequest @parameters
}

function Get-KeycloakItems {
    param([string]$Path, [hashtable]$Headers)
    $response = Invoke-KeycloakRequest GET $Path $Headers
    $parsed = $response.Content | ConvertFrom-Json
    if ($null -eq $parsed) { return }
    foreach ($item in @($parsed)) { Write-Output $item }
}

function Wait-HttpStatus {
    param([string]$Uri, [int]$Expected=200, [int]$Seconds=120)
    $deadline = [DateTimeOffset]::UtcNow.AddSeconds($Seconds)
    do {
        try {
            $response = Invoke-WebRequest -UseBasicParsing -Uri $Uri -TimeoutSec 10
            if ([int]$response.StatusCode -eq $Expected) { return }
        }
        catch {}
        Start-Sleep -Seconds 2
    } while ([DateTimeOffset]::UtcNow -lt $deadline)
    throw "Timed out waiting for HTTP $Expected from $Uri."
}

$protectedBefore = Get-ProtectedSnapshot
$evidence = [ordered]@{
    Verdict = 'FAIL'
    StartedAtUtc = [DateTimeOffset]::UtcNow.ToString('o')
    InstallerIdentity = [Security.Principal.WindowsIdentity]::GetCurrent().Name
    GitHead = (& git -c safe.directory=C:/DLE-OS/Repositories/DLE-OS -C $repository rev-parse HEAD)
    ProtectedBefore = $protectedBefore
    KeycloakVersion = $keycloakVersion
    JavaMajorVersion = 21
    ServiceIdentity = $serviceIdentity
    Database = 'DLE_OS_KEYCLOAK_DEV'
}
$databasePassword = $null
$adminPassword = $null
$miguelPassword = $null
$oidcClientSecret = $null
$adminHeaders = $null

try {
    foreach ($directory in $phaseRoot,$stateRoot,$logRoot,$dataRoot,$backupRoot,$packageRoot,$scriptRoot,$deployRoot) {
        New-Item -ItemType Directory -Path $directory -Force | Out-Null
    }

    $databasePassword = Unprotect-Secret 'database-password' 'DLE-OS|Keycloak|Database|v1'
    $adminPassword = Unprotect-Secret 'bootstrap-admin-password' 'DLE-OS|Keycloak|Bootstrap-Admin|v1'
    $miguelPassword = Unprotect-Secret 'miguel-initial-password' 'DLE-OS|Keycloak|Miguel-Initial|v1'
    $oidcClientSecret = Unprotect-Secret 'oidc-client-secret' 'DLE-OS|Keycloak|OIDC-Client|v1'
    $evidence.SecretVerification = 'PASS: four non-empty DPAPI LocalMachine values'

    $keycloakZip = Join-Path $packageRoot "keycloak-$keycloakVersion.zip"
    $javaZip = Join-Path $packageRoot 'microsoft-jdk-21-windows-x64.zip'
    $daemonZip = Join-Path $packageRoot "commons-daemon-$daemonVersion-bin-windows.zip"
    $jdbcAuthDll = Join-Path $packageRoot "mssql-jdbc_auth-$jdbcAuthVersion.x64.dll"
    Invoke-Download $keycloakUrl $keycloakZip
    Invoke-Download $javaUrl $javaZip
    Invoke-Download $daemonUrl $daemonZip
    Invoke-Download $jdbcAuthUrl $jdbcAuthDll
    $evidence.PackageHashes = [ordered]@{
        KeycloakSha256 = Assert-PinnedHash $keycloakZip SHA256 $keycloakSha256
        JavaSha256 = Assert-PinnedHash $javaZip SHA256 $javaSha256
        CommonsDaemonSha512 = Assert-PinnedHash $daemonZip SHA512 $daemonSha512
        JdbcAuthSha256 = Assert-PinnedHash $jdbcAuthDll SHA256 $jdbcAuthSha256
    }

    if (-not (Test-Path -LiteralPath (Join-Path $keycloakHome 'bin\kc.bat'))) {
        $extract = Join-Path $packageRoot ('extract-keycloak-' + [Guid]::NewGuid().ToString('N'))
        Expand-Archive -LiteralPath $keycloakZip -DestinationPath $extract
        New-Item -ItemType Directory -Path (Split-Path $keycloakHome -Parent) -Force | Out-Null
        Move-Item -LiteralPath (Join-Path $extract "keycloak-$keycloakVersion") -Destination $keycloakHome
        Remove-Item -LiteralPath $extract -Force
    }
    if (-not (Test-Path -LiteralPath (Join-Path $javaHome 'bin\java.exe'))) {
        $extract = Join-Path $packageRoot ('extract-java-' + [Guid]::NewGuid().ToString('N'))
        Expand-Archive -LiteralPath $javaZip -DestinationPath $extract
        $jdk = Get-ChildItem -LiteralPath $extract -Directory | Select-Object -First 1
        if (-not $jdk) { throw 'The Microsoft OpenJDK archive contained no JDK directory.' }
        New-Item -ItemType Directory -Path (Split-Path $javaHome -Parent) -Force | Out-Null
        Move-Item -LiteralPath $jdk.FullName -Destination $javaHome
        Remove-Item -LiteralPath $extract -Force
    }
    $daemonExtract = Join-Path $packageRoot "commons-daemon-$daemonVersion"
    if (-not (Test-Path -LiteralPath $daemonExtract))
        { Expand-Archive -LiteralPath $daemonZip -DestinationPath $daemonExtract }
    $prunsrvSource = Get-ChildItem -LiteralPath $daemonExtract -Recurse -Filter prunsrv.exe |
        Where-Object FullName -Match '[\\/]amd64[\\/]' | Select-Object -First 1
    if (-not $prunsrvSource) { throw 'The Apache Commons Daemon amd64 service wrapper is absent.' }

    $keycloakDataPath = Join-Path $keycloakHome 'data'
    if ((Test-Path -LiteralPath $keycloakDataPath) -and
        (Get-Item -LiteralPath $keycloakDataPath).LinkType -ne 'Junction') {
        if ((Get-ChildItem -LiteralPath $keycloakDataPath -Force).Count -ne 0)
            { throw 'The fresh Keycloak runtime data directory is unexpectedly non-empty.' }
        Remove-Item -LiteralPath $keycloakDataPath -Force
    }
    if (-not (Test-Path -LiteralPath $keycloakDataPath))
        { New-Item -ItemType Junction -Path $keycloakDataPath -Target $dataRoot | Out-Null }

    Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'Start-DleOsKeycloak.ps1') `
        -Destination (Join-Path $scriptRoot 'Start-DleOsKeycloak.ps1') -Force
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'Stop-DleOsKeycloak.ps1') `
        -Destination (Join-Path $scriptRoot 'Stop-DleOsKeycloak.ps1') -Force
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'Test-DleOsKeycloakHealth.ps1') `
        -Destination (Join-Path $scriptRoot 'Test-DleOsKeycloakHealth.ps1') -Force
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'Initialize-DleOsKeycloakDatabase.ps1') `
        -Destination (Join-Path $scriptRoot 'Initialize-DleOsKeycloakDatabase.ps1') -Force
    Set-GovernedDirectoryAcl $scriptRoot @('NT AUTHORITY\SYSTEM')

    $configuration = @"
db=mssql
db-url=jdbc:sqlserver://127.0.0.1:14330;databaseName=DLE_OS_KEYCLOAK_DEV;encrypt=false;trustServerCertificate=true;integratedSecurity=true;authenticationScheme=NativeAuthentication
transaction-xa-enabled=false
hostname=https://auth.internal.dlemfg.com
hostname-strict=true
http-enabled=true
http-host=127.0.0.1
http-port=8180
http-management-host=127.0.0.1
http-management-port=9190
proxy-headers=xforwarded
proxy-trusted-addresses=127.0.0.1
health-enabled=true
metrics-enabled=false
cache=local
log=console,file
log-level=INFO
log-file=C:/ProgramData/DLE-OS/Keycloak/Logs/keycloak.log
"@
    Set-Content -LiteralPath (Join-Path $keycloakHome 'conf\keycloak.conf') `
        -Value $configuration -Encoding ASCII

    $databaseTaskName = 'DLE-OS Keycloak Database Bootstrap'
    $databaseResultPath = Join-Path $stateRoot 'database-bootstrap.json'
    if (Test-Path -LiteralPath $databaseResultPath) { Remove-Item -LiteralPath $databaseResultPath -Force }
    $databaseAction = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument `
        ('-NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "' +
         (Join-Path $scriptRoot 'Initialize-DleOsKeycloakDatabase.ps1') + '"')
    $databasePrincipal = New-ScheduledTaskPrincipal -UserId $frontendIdentity `
        -LogonType Interactive -RunLevel Highest
    $databaseSettings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit (New-TimeSpan -Minutes 5)
    try {
        Register-ScheduledTask -TaskName $databaseTaskName -Action $databaseAction `
            -Principal $databasePrincipal -Settings $databaseSettings -Force | Out-Null
        Start-ScheduledTask -TaskName $databaseTaskName
        $databaseDeadline = [DateTimeOffset]::UtcNow.AddMinutes(5)
        while (-not (Test-Path -LiteralPath $databaseResultPath) -and
               [DateTimeOffset]::UtcNow -lt $databaseDeadline) {
            Start-Sleep -Seconds 1
        }
        if (-not (Test-Path -LiteralPath $databaseResultPath)) {
            throw 'The SYSTEM Keycloak database bootstrap did not produce evidence within five minutes.'
        }
        $databaseResult = Get-Content -LiteralPath $databaseResultPath -Raw | ConvertFrom-Json
        if ($databaseResult.Verdict -ne 'PASS') {
            throw "The governed Keycloak database bootstrap failed: $($databaseResult.Error)"
        }
        $evidence.DatabaseBootstrap = "PASS: $frontendIdentity"
    }
    finally {
        Unregister-ScheduledTask -TaskName $databaseTaskName -Confirm:$false -ErrorAction SilentlyContinue
    }

    $existingKeycloakService = Get-Service -Name $serviceName -ErrorAction SilentlyContinue
    if ($existingKeycloakService -and $existingKeycloakService.Status -ne 'Stopped') {
        Stop-Service -Name $serviceName -Force
        $existingKeycloakService.WaitForStatus('Stopped', [TimeSpan]::FromSeconds(90))
    }
    Copy-FileIfChanged $prunsrvSource.FullName (Join-Path $keycloakHome 'bin\prunsrv.exe')
    Copy-FileIfChanged $jdbcAuthDll (Join-Path $javaHome 'bin\mssql-jdbc_auth-13.2.1.x64.dll')
    $env:JAVA_HOME = $javaHome
    & (Join-Path $keycloakHome 'bin\kc.bat') build --db=mssql --health-enabled=true
    if ($LASTEXITCODE -ne 0) { throw 'The optimized Keycloak build failed.' }

    $prunsrv = Join-Path $keycloakHome 'bin\prunsrv.exe'
    if (-not (Get-Service -Name $serviceName -ErrorAction SilentlyContinue)) {
        $powershell = "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe"
        $serviceArguments = @(
            "//IS//$serviceName",
            '--DisplayName=DLE-OS Keycloak Identity Provider',
            '--Description=DLE-OS Phase 6.2C private Keycloak identity provider',
            '--Startup=delayed',
            "--ServiceUser=$serviceIdentity",
            '--StartMode=exe',
            "--StartImage=$powershell",
            "--StartPath=$keycloakHome",
            "--StartParams=-NoLogo#-NoProfile#-NonInteractive#-ExecutionPolicy#Bypass#-File#$(Join-Path $scriptRoot 'Start-DleOsKeycloak.ps1')",
            '--StopMode=exe',
            "--StopImage=$powershell",
            "--StopPath=$keycloakHome",
            "--StopParams=-NoLogo#-NoProfile#-NonInteractive#-ExecutionPolicy#Bypass#-File#$(Join-Path $scriptRoot 'Stop-DleOsKeycloak.ps1')",
            '--StopTimeout=30',
            '--DependsOn=MSSQL$SQLEXPRESS#Tcpip#Afd',
            "--LogPath=$logRoot",
            '--LogPrefix=keycloak-service',
            '--LogLevel=Info',
            '--StdOutput=auto',
            '--StdError=auto'
        )
        & $prunsrv @serviceArguments
        if ($LASTEXITCODE -ne 0) { throw 'The dedicated Keycloak Windows service installation failed.' }
    }
    else {
        $powershell = "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe"
        $serviceUpdateArguments = @(
            "//US//$serviceName",
            '--StopMode=exe',
            "--StopImage=$powershell",
            "--StopPath=$keycloakHome",
            "--StopParams=-NoLogo#-NoProfile#-NonInteractive#-ExecutionPolicy#Bypass#-File#$(Join-Path $scriptRoot 'Stop-DleOsKeycloak.ps1')",
            '--StopTimeout=30'
        )
        & $prunsrv @serviceUpdateArguments
        if ($LASTEXITCODE -ne 0) { throw 'The dedicated Keycloak Windows service stop configuration update failed.' }
    }

    Set-GovernedDirectoryAcl $keycloakHome @($serviceIdentity)
    Set-GovernedDirectoryAcl $dataRoot @() @($serviceIdentity)
    Set-GovernedDirectoryAcl $logRoot @() @($serviceIdentity)
    Set-GovernedDirectoryAcl $backupRoot @() @($serviceIdentity)
    Set-GovernedDirectoryAcl $scriptRoot @($serviceIdentity)
    & icacls.exe $secretRoot '/grant' "${serviceIdentity}:(RX)" "${frontendIdentity}:(RX)" | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Secret-directory traversal ACL configuration failed.' }
    Grant-ExactFileRead (Join-Path $secretRoot 'bootstrap-admin-password.dpapi') $serviceIdentity
    Grant-ExactFileRead (Join-Path $secretRoot 'oidc-client-secret.dpapi') $frontendIdentity

    $loopbackSqlEvidence = & (Join-Path $PSScriptRoot 'Enable-DleOsKeycloakLoopbackSql.ps1')
    if ($loopbackSqlEvidence.Verdict -ne 'PASS') {
        throw 'The approved loopback-only SQL transport qualification failed.'
    }
    $evidence.LoopbackSql = [ordered]@{
        Listener=$loopbackSqlEvidence.LoopbackListener;
        LanListener=$loopbackSqlEvidence.LanListener;
        FirewallChanged=$loopbackSqlEvidence.FirewallChanged;
        RestartCount=$loopbackSqlEvidence.RestartCount
    }

    Start-Service -Name $serviceName
    Wait-HttpStatus 'http://127.0.0.1:9190/health/ready' 200 180

    $adminUsername = if (Test-Path -LiteralPath $bootstrapMarker) {
        'dleos-admin'
    } else {
        'dleos-bootstrap-admin'
    }
    $tokenResponse = Invoke-RestMethod -UseBasicParsing -Method Post `
        -Uri 'http://127.0.0.1:8180/realms/master/protocol/openid-connect/token' `
        -ContentType 'application/x-www-form-urlencoded' `
        -Body @{grant_type='password';client_id='admin-cli';username=$adminUsername;password=$adminPassword}
    $adminHeaders = @{ Authorization = "Bearer $($tokenResponse.access_token)" }

    $realmExists = $true
    try { [void](Invoke-KeycloakRequest GET '/admin/realms/dle-os' $adminHeaders) }
    catch { if ([int]$_.Exception.Response.StatusCode -eq 404) {$realmExists=$false} else {throw} }
    $realm = [ordered]@{
        realm='dle-os';displayName='DLE-OS';enabled=$true;sslRequired='all';
        registrationAllowed=$false;registrationEmailAsUsername=$false;rememberMe=$false;
        verifyEmail=$false;loginWithEmailAllowed=$false;duplicateEmailsAllowed=$false;
        resetPasswordAllowed=$false;editUsernameAllowed=$false;bruteForceProtected=$true;
        passwordPolicy='length(16) and notUsername(undefined)';
        ssoSessionIdleTimeout=1800;ssoSessionMaxLifespan=28800;
        accessTokenLifespan=300;revokeRefreshToken=$true;refreshTokenMaxReuse=0
    }
    if ($realmExists) { [void](Invoke-KeycloakRequest PUT '/admin/realms/dle-os' $adminHeaders $realm) }
    else { [void](Invoke-KeycloakRequest POST '/admin/realms' $adminHeaders $realm) }

    $userProfile = (Invoke-KeycloakRequest GET '/admin/realms/dle-os/users/profile' $adminHeaders).Content |
        ConvertFrom-Json
    $emailAttributes = @($userProfile.attributes | Where-Object name -EQ 'email')
    if ($emailAttributes.Count -ne 1) { throw 'The DLE-OS realm email profile attribute is not unique.' }
    $emailAttributes[0].PSObject.Properties.Remove('required')
    [void](Invoke-KeycloakRequest PUT '/admin/realms/dle-os/users/profile' $adminHeaders $userProfile)
    $verifiedUserProfile = (Invoke-KeycloakRequest GET '/admin/realms/dle-os/users/profile' $adminHeaders).Content |
        ConvertFrom-Json
    $verifiedEmail = @($verifiedUserProfile.attributes | Where-Object name -EQ 'email')
    if ($verifiedEmail.Count -ne 1 -or
        $verifiedEmail[0].PSObject.Properties.Name -contains 'required') {
        throw 'The DLE-OS realm email attribute remains required.'
    }
    $evidence.EmailProfile = 'OPTIONAL'

    $client = [ordered]@{
        clientId='dle-os-development-bff';name='DLE-OS Development BFF';enabled=$true;
        protocol='openid-connect';clientAuthenticatorType='client-secret';secret=$oidcClientSecret;
        publicClient=$false;bearerOnly=$false;standardFlowEnabled=$true;implicitFlowEnabled=$false;
        directAccessGrantsEnabled=$false;serviceAccountsEnabled=$false;
        rootUrl='https://dle-os.internal.dlemfg.com';baseUrl='https://dle-os.internal.dlemfg.com/';
        redirectUris=@('https://dle-os.internal.dlemfg.com/signin-oidc');
        webOrigins=@('https://dle-os.internal.dlemfg.com');
        attributes=[ordered]@{
            'pkce.code.challenge.method'='S256';
            'post.logout.redirect.uris'='https://dle-os.internal.dlemfg.com/shared';
            'oauth2.device.authorization.grant.enabled'='false';
            'oidc.ciba.grant.enabled'='false';
            'backchannel.logout.session.required'='true'
        }
        defaultClientScopes=@('web-origins','profile')
        optionalClientScopes=@()
    }
    $clients = @(Get-KeycloakItems '/admin/realms/dle-os/clients?clientId=dle-os-development-bff' $adminHeaders)
    if ($clients.Count -eq 0) { [void](Invoke-KeycloakRequest POST '/admin/realms/dle-os/clients' $adminHeaders $client) }
    else { [void](Invoke-KeycloakRequest PUT "/admin/realms/dle-os/clients/$($clients[0].id)" $adminHeaders $client) }

    $users = @(Get-KeycloakItems '/admin/realms/dle-os/users?username=miguel&exact=true' $adminHeaders)
    if ($users.Count -eq 0) {
        [void](Invoke-KeycloakRequest POST '/admin/realms/dle-os/users' $adminHeaders `
            ([ordered]@{username='miguel';enabled=$true;firstName='Miguel';lastName='De Leon';emailVerified=$false;requiredActions=@()}))
        $users = @(Get-KeycloakItems '/admin/realms/dle-os/users?username=miguel&exact=true' $adminHeaders)
    }
    if ($users.Count -ne 1) { throw 'The Miguel Keycloak user is not unique.' }
    $miguelSubject = [string]$users[0].id
    [void](Invoke-KeycloakRequest PUT "/admin/realms/dle-os/users/$miguelSubject/reset-password" $adminHeaders `
        ([ordered]@{type='password';value=$miguelPassword;temporary=$false}))
    $realmUsers = @(Get-KeycloakItems '/admin/realms/dle-os/users?max=100' $adminHeaders)
    if ($realmUsers.Count -ne 1 -or $realmUsers[0].username -ne 'miguel')
        { throw 'Phase 6.2C permits only the Miguel realm user.' }

    $migration = Get-Content -LiteralPath (Join-Path $repository `
        'Tools\SecurityFoundation\Database\005_AddKeycloakExternalIdentity.sql') -Raw
    Invoke-SqlBatch DLE_OS_SECURITY_DEV $migration
    Invoke-SqlBatch DLE_OS_SECURITY_DEV `
        'EXEC security.usp_LinkMiguelKeycloakIdentity @Subject=@KeycloakSubject,@Actor=@ProvisioningActor;' `
        @{KeycloakSubject=$miguelSubject;ProvisioningActor='PHASE_6_2C_KEYCLOAK_BOOTSTRAP'}

    $permanentAdmins = @(Get-KeycloakItems '/admin/realms/master/users?username=dleos-admin&exact=true' $adminHeaders)
    if ($permanentAdmins.Count -eq 0) {
        [void](Invoke-KeycloakRequest POST '/admin/realms/master/users' $adminHeaders `
            ([ordered]@{username='dleos-admin';enabled=$true;firstName='DLE-OS';lastName='Administrator';requiredActions=@()}))
        $permanentAdmins = @(Get-KeycloakItems '/admin/realms/master/users?username=dleos-admin&exact=true' $adminHeaders)
    }
    if ($permanentAdmins.Count -ne 1) { throw 'The permanent Keycloak administrator is not unique.' }
    $permanentAdminId = [string]$permanentAdmins[0].id
    [void](Invoke-KeycloakRequest PUT "/admin/realms/master/users/$permanentAdminId/reset-password" $adminHeaders `
        ([ordered]@{type='password';value=$adminPassword;temporary=$false}))
    $masterAdminRole = (Invoke-KeycloakRequest GET `
        '/admin/realms/master/roles/admin' $adminHeaders).Content |
        ConvertFrom-Json
    $roleMappingJson = '[' + ($masterAdminRole | ConvertTo-Json -Depth 6 -Compress) + ']'
    [void](Invoke-WebRequest -UseBasicParsing -Method POST `
        -Uri "http://127.0.0.1:8180/admin/realms/master/users/$permanentAdminId/role-mappings/realm" `
        -Headers $adminHeaders -ContentType 'application/json' -Body $roleMappingJson)
    $bootstrapAdmins = @(Get-KeycloakItems `
        '/admin/realms/master/users?username=dleos-bootstrap-admin&exact=true' $adminHeaders)
    foreach ($bootstrapAdmin in $bootstrapAdmins) {
        [void](Invoke-KeycloakRequest DELETE "/admin/realms/master/users/$($bootstrapAdmin.id)" $adminHeaders)
    }

    New-Item -ItemType Directory -Path $stateRoot -Force | Out-Null
    [ordered]@{completedAtUtc=[DateTimeOffset]::UtcNow.ToString('o');realm='dle-os';miguelSubject=$miguelSubject;permanentAdmin='dleos-admin'} |
        ConvertTo-Json | Set-Content -LiteralPath $bootstrapMarker -Encoding UTF8
    Grant-ExactFileRead (Join-Path $secretRoot 'bootstrap-admin-password.dpapi') 'BUILTIN\Administrators'

    $acmeScriptRoot = 'C:\ProgramData\DLE-OS\ACME\Scripts'
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'Invoke-DleOsGoDaddyDns01.ps1') `
        -Destination (Join-Path $acmeScriptRoot 'Invoke-DleOsGoDaddyDns01.ps1') -Force
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'Update-DleOsKeycloakHttpsBinding.ps1') `
        -Destination (Join-Path $acmeScriptRoot 'Update-DleOsKeycloakHttpsBinding.ps1') -Force
    Set-GovernedDirectoryAcl $acmeScriptRoot

    $certificates = @(Get-ChildItem Cert:\LocalMachine\My |
        Where-Object { $authHostname -in @($_.DnsNameList.Unicode) } |
        Sort-Object NotAfter -Descending)
    if ($certificates.Count -eq 0 -or $certificates[0].NotAfter -lt (Get-Date).AddDays(30)) {
        $wacs = 'C:\ProgramData\DLE-OS\ACME\win-acme\wacs.exe'
        $wacsArguments = @(
            '--source','manual','--host',$authHostname,
            '--friendlyname','DLE-OS Keycloak HTTPS',
            '--validationmode','dns-01','--validation','script',
            '--dnsscript',(Join-Path $acmeScriptRoot 'Invoke-DleOsGoDaddyDns01.ps1'),
            '--dnsscriptparallelism','0','--store','certificatestore','--certificatestore','My',
            '--acl-read','NT AUTHORITY\SYSTEM','--installation','script',
            '--script',(Join-Path $acmeScriptRoot 'Update-DleOsKeycloakHttpsBinding.ps1'),
            '--scriptparameters','-NewThumbprint {CertThumbprint}',
            '--accepttos','--emailaddress','systems.deleon@gmail.com','--closeonfinish'
        )
        & $wacs @wacsArguments
        if ($LASTEXITCODE -ne 0) { throw 'The separate Keycloak certificate issuance failed.' }
        $certificates = @(Get-ChildItem Cert:\LocalMachine\My |
            Where-Object { $authHostname -in @($_.DnsNameList.Unicode) } |
            Sort-Object NotAfter -Descending)
    }
    if ($certificates.Count -eq 0) { throw 'The Keycloak certificate is absent after issuance.' }
    & (Join-Path $acmeScriptRoot 'Update-DleOsKeycloakHttpsBinding.ps1') `
        -NewThumbprint $certificates[0].Thumbprint

    $urlAcl = netsh http show urlacl "url=https://$authHostname`:443/" 2>&1 | Out-String
    if ($LASTEXITCODE -ne 0 -or $urlAcl -notmatch [regex]::Escape($frontendIdentity)) {
        if ($LASTEXITCODE -eq 0) { netsh http delete urlacl "url=https://$authHostname`:443/" | Out-Null }
        netsh http add urlacl "url=https://$authHostname`:443/" "user=$frontendIdentity" listen=yes | Out-Null
        if ($LASTEXITCODE -ne 0) { throw 'The Keycloak HTTPS URL ACL could not be created.' }
    }

    $frontendProject = Join-Path $repository 'Tools\DevelopmentRuntime\DleOs.DevelopmentFrontend\DleOs.DevelopmentFrontend.csproj'
    $frontendPublish = Join-Path $deployRoot 'frontend'
    $frontendArtifacts = Join-Path $deployRoot 'frontend-artifacts'
    if (Test-Path -LiteralPath $frontendPublish) { Remove-Item -LiteralPath $frontendPublish -Recurse -Force }
    if (Test-Path -LiteralPath $frontendArtifacts) { Remove-Item -LiteralPath $frontendArtifacts -Recurse -Force }
    & dotnet publish $frontendProject -c Release -o $frontendPublish --artifacts-path $frontendArtifacts
    if ($LASTEXITCODE -ne 0) { throw 'The OIDC development BFF publish failed.' }

    $worker = Get-CimInstance Win32_Process -Filter "Name='dotnet.exe'" |
        Where-Object { $_.CommandLine -like '*DleOs.DevelopmentFrontend.dll*' } |
        Select-Object -First 1
    if (-not $worker) { throw 'The existing development BFF worker was not found.' }
    Stop-Process -Id $worker.ProcessId -Force -Confirm:$false
    $deadline = [DateTimeOffset]::UtcNow.AddSeconds(30)
    while ((Get-ListenerPid 5051) -and [DateTimeOffset]::UtcNow -lt $deadline) { Start-Sleep -Milliseconds 250 }
    if (Get-ListenerPid 5051) { throw 'The development BFF did not release HTTP.sys 5051.' }
    $frontendRuntime = Join-Path $repository 'Tools\DevelopmentRuntime\DleOs.DevelopmentFrontend\bin\Release\net8.0-windows'
    New-Item -ItemType Directory -Path $frontendRuntime -Force | Out-Null
    Copy-Item -Path (Join-Path $frontendPublish '*') -Destination $frontendRuntime -Recurse -Force
    Start-ScheduledTask -TaskName $frontendTask
    Wait-HttpStatus "https://$appHostname/shared" 200 90
    Wait-HttpStatus "https://$authHostname/realms/dle-os/.well-known/openid-configuration" 200 90

    if (-not [Diagnostics.EventLog]::SourceExists('DLE-OS Keycloak'))
        { New-EventLog -LogName Application -Source 'DLE-OS Keycloak' }
    $healthAction = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument `
        ('-NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "' +
         (Join-Path $scriptRoot 'Test-DleOsKeycloakHealth.ps1') + '"')
    $healthTrigger = New-ScheduledTaskTrigger -Daily -At '4:15 PM'
    $healthPrincipal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
    $healthSettings = New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Minutes 5)
    Register-ScheduledTask -TaskName 'DLE-OS Keycloak Health Check' -Action $healthAction `
        -Trigger $healthTrigger -Principal $healthPrincipal -Settings $healthSettings -Force | Out-Null
    Start-ScheduledTask -TaskName 'DLE-OS Keycloak Health Check'

    $protectedAfter = Get-ProtectedSnapshot
    $evidence.ProtectedAfter = $protectedAfter
    foreach ($port in $protectedPorts) {
        if ($protectedBefore[[string]$port] -ne $protectedAfter[[string]$port])
            { throw "Protected listener $port changed during Phase 6.2C." }
    }
    $service = Get-CimInstance Win32_Service -Filter "Name='$serviceName'"
    $evidence.KeycloakService = [ordered]@{State=$service.State;StartName=$service.StartName;ProcessId=$service.ProcessId}
    $evidence.Certificate = [ordered]@{
        Subject=$certificates[0].Subject;Thumbprint=$certificates[0].Thumbprint;
        NotAfterUtc=$certificates[0].NotAfter.ToUniversalTime().ToString('o');
        DnsNames=@($certificates[0].DnsNameList.Unicode)
    }
    $evidence.Realm = 'dle-os'
    $evidence.Client = 'dle-os-development-bff'
    $evidence.RedirectUri = 'https://dle-os.internal.dlemfg.com/signin-oidc'
    $evidence.PostLogoutRedirectUri = 'https://dle-os.internal.dlemfg.com/shared'
    $evidence.MiguelUserId = '7cceaf7a-191a-452a-95ff-f9ab636ec5c4'
    $evidence.MiguelKeycloakSubject = $miguelSubject
    $evidence.DanielActivated = $false
    $evidence.Verdict = 'PASS'
}
catch {
    $evidence.Error = $_.Exception.Message
    $evidence.ErrorPosition = [string]$_.InvocationInfo.PositionMessage
    $evidence.ErrorStack = [string]$_.ScriptStackTrace
    throw
}
finally {
    $databasePassword = $null
    $adminPassword = $null
    $miguelPassword = $null
    $oidcClientSecret = $null
    if ($adminHeaders) { $adminHeaders.Clear() }
    $evidence.CompletedAtUtc = [DateTimeOffset]::UtcNow.ToString('o')
    New-Item -ItemType Directory -Path $phaseRoot -Force | Out-Null
    $evidence | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $resultPath -Encoding UTF8
}

[pscustomobject]$evidence
