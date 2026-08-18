[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

function Test-IsAdministrator {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    return [Security.Principal.WindowsPrincipal]::new($identity).IsInRole(
        [Security.Principal.WindowsBuiltInRole]::Administrator)
}

if (-not (Test-IsAdministrator)) {
    $arguments = @('-NoLogo','-NoProfile','-ExecutionPolicy','Bypass','-File',('"{0}"' -f $PSCommandPath))
    $process = Start-Process powershell.exe -Verb RunAs -ArgumentList $arguments -Wait -PassThru
    exit $process.ExitCode
}

Add-Type -AssemblyName System.Security
$repository = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')).Path
$migrationPath = Join-Path $repository 'Tools\SecurityFoundation\Database\009_AddDevKittingTestPersona.sql'
$evidencePath = Join-Path $repository '.tmp\dev-test-identities\dev.kitting.json'
$secretPath = 'C:\ProgramData\DLE-OS\Keycloak\Secrets\provisioning-client-secret.dpapi'
$connectionString = 'Server=lpc:.\SQLEXPRESS;Database=DLE_OS_SECURITY_DEV;Integrated Security=True;Encrypt=False;TrustServerCertificate=True'
$actor = 'DEV_TEST_IDENTITY_PROVISIONER'
$protectedPorts = 5041,5042,5043,5052,5053,5054

function Get-ProtectedSnapshot {
    $state = [ordered]@{}
    foreach ($port in $protectedPorts) {
        $listeners = @(Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue |
            Select-Object -ExpandProperty OwningProcess -Unique)
        $state[[string]$port] = $listeners
    }
    return $state
}

function Invoke-Keycloak {
    param([string]$Method,[string]$Path,[hashtable]$Headers,$Body=$null)
    $parameters = @{UseBasicParsing=$true;Method=$Method;Uri="http://127.0.0.1:8180$Path";Headers=$Headers}
    if ($null -ne $Body) {
        $parameters.ContentType = 'application/json'
        $parameters.Body = $Body | ConvertTo-Json -Depth 12 -Compress
    }
    return Invoke-WebRequest @parameters
}

function Invoke-SqlBatches {
    param([string]$Script)
    $connection = [System.Data.SqlClient.SqlConnection]::new($connectionString)
    try {
        $connection.Open()
        if ($connection.Database -ne 'DLE_OS_SECURITY_DEV') { throw 'The DEV security database boundary is invalid.' }
        foreach ($batch in [regex]::Split($Script,'(?im)^\s*GO\s*$')) {
            if ([string]::IsNullOrWhiteSpace($batch)) { continue }
            $command = $connection.CreateCommand()
            try { $command.CommandText=$batch; $command.CommandTimeout=180; [void]$command.ExecuteNonQuery() }
            finally { $command.Dispose() }
        }
    }
    finally { $connection.Dispose() }
}

function Get-DatabasePersona {
    $connection = [System.Data.SqlClient.SqlConnection]::new($connectionString)
    try {
        $connection.Open()
        $command = $connection.CreateCommand()
        try {
            $command.CommandText = @"
SELECT u.UserId,u.UserName,u.DisplayName,u.AccountStatus,ei.Subject,r.RoleCode,r.IsSuperAdmin,
       (SELECT STRING_AGG(p.PermissionCode,',') WITHIN GROUP (ORDER BY p.PermissionCode)
        FROM security.UserRole ur2
        JOIN security.RolePermission rp ON rp.RoleId=ur2.RoleId AND rp.IsActive=1
        JOIN security.Permission p ON p.PermissionId=rp.PermissionId AND p.IsActive=1
        WHERE ur2.UserId=u.UserId AND ur2.IsActive=1) AS Permissions,
       (SELECT COUNT(*) FROM security.UserEmployeeLink link WHERE link.UserId=u.UserId) AS EmployeeLinks
FROM security.[User] u
LEFT JOIN security.ExternalIdentity ei ON ei.UserId=u.UserId AND ei.Provider='KEYCLOAK' AND ei.IsActive=1
LEFT JOIN security.UserRole ur ON ur.UserId=u.UserId AND ur.IsActive=1
LEFT JOIN security.[Role] r ON r.RoleId=ur.RoleId AND r.IsActive=1
WHERE u.NormalizedUserName=N'DEV.KITTING';
"@
            $reader = $command.ExecuteReader()
            try {
                if (-not $reader.Read()) { return $null }
                return [ordered]@{
                    UserId=[string]$reader.GetGuid(0);UserName=$reader.GetString(1);DisplayName=$reader.GetString(2)
                    AccountStatus=$reader.GetString(3);Subject=if($reader.IsDBNull(4)){$null}else{$reader.GetString(4)}
                    RoleCode=if($reader.IsDBNull(5)){$null}else{$reader.GetString(5)}
                    IsSuperAdmin=if($reader.IsDBNull(6)){$false}else{$reader.GetBoolean(6)}
                    Permissions=if($reader.IsDBNull(7)){@()}else{@($reader.GetString(7).Split(','))}
                    EmployeeLinks=$reader.GetInt32(8)
                }
            }
            finally { $reader.Dispose() }
        }
        finally { $command.Dispose() }
    }
    finally { $connection.Dispose() }
}

function Get-RealIdentitySnapshot {
    $connection = [System.Data.SqlClient.SqlConnection]::new($connectionString)
    try {
        $connection.Open(); $command=$connection.CreateCommand()
        try {
            $command.CommandText = @"
SELECT u.NormalizedUserName,u.AccountStatus,
       (SELECT STRING_AGG(r.RoleCode,',') WITHIN GROUP (ORDER BY r.RoleCode)
        FROM security.UserRole ur JOIN security.[Role] r ON r.RoleId=ur.RoleId
        WHERE ur.UserId=u.UserId AND ur.IsActive=1 AND r.IsActive=1),
       (SELECT COUNT(*) FROM security.ExternalIdentity ei WHERE ei.UserId=u.UserId AND ei.IsActive=1)
FROM security.[User] u WHERE u.NormalizedUserName IN (N'MIGUEL',N'DANIEL') ORDER BY u.NormalizedUserName;
"@
            $reader=$command.ExecuteReader(); $items=@()
            try { while($reader.Read()){$items += [ordered]@{UserName=$reader.GetString(0);AccountStatus=$reader.GetString(1);Roles=if($reader.IsDBNull(2)){$null}else{$reader.GetString(2)};ActiveExternalIdentities=$reader.GetInt32(3)}} }
            finally {$reader.Dispose()}
            return $items
        }
        finally {$command.Dispose()}
    }
    finally {$connection.Dispose()}
}

function Get-PlainText {
    param([Security.SecureString]$SecureValue)
    $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($SecureValue)
    try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer) }
    finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }
}

$before = Get-ProtectedSnapshot
$realBefore = Get-RealIdentitySnapshot
$evidence = [ordered]@{Verdict='FAIL';StartedAtUtc=[DateTimeOffset]::UtcNow.ToString('o');Environment='DEVELOPMENT';Database='DLE_OS_SECURITY_DEV';UserName='dev.kitting';ProtectedBefore=$before;RealIdentitiesBefore=$realBefore;CredentialRecorded=$false}
$secretProtected=$null;$secretEntropy=$null;$secretPlain=$null;$clientSecret=$null;$accessToken=$null;$password=$null;$confirmPassword=$null;$createdSubject=$null;$keycloakEnabled=$false

try {
    Invoke-SqlBatches (Get-Content -LiteralPath $migrationPath -Raw)

    $secretProtected=[IO.File]::ReadAllBytes($secretPath)
    $secretEntropy=[Text.Encoding]::UTF8.GetBytes('DLE-OS|Keycloak|Provisioning-Client|v1')
    $secretPlain=[Security.Cryptography.ProtectedData]::Unprotect($secretProtected,$secretEntropy,[Security.Cryptography.DataProtectionScope]::LocalMachine)
    $clientSecret=[Text.Encoding]::UTF8.GetString($secretPlain)
    $token=Invoke-RestMethod -UseBasicParsing -Method Post -Uri 'http://127.0.0.1:8180/realms/dle-os/protocol/openid-connect/token' -ContentType 'application/x-www-form-urlencoded' -Body @{grant_type='client_credentials';client_id='dle-os-provisioning-bff';client_secret=$clientSecret}
    $accessToken=$token.access_token
    $headers=@{Authorization="Bearer $accessToken"}
    $databasePersona=Get-DatabasePersona

    if ($null -eq $databasePersona) {
        Write-Host 'Create DEV test identity: dev.kitting' -ForegroundColor Cyan
        Write-Host 'Enter the password Miguel will save on the Kitting iPad. It will not be displayed or recorded.'
        $password=Get-PlainText (Read-Host 'Initial password' -AsSecureString)
        $confirmPassword=Get-PlainText (Read-Host 'Confirm initial password' -AsSecureString)
        if ($password -cne $confirmPassword) { throw 'The password confirmation did not match.' }
        if ($password.Length -lt 15 -or $password.Length -gt 128) { throw 'The password must be between 15 and 128 characters.' }

        $definition=[ordered]@{username='dev.kitting';enabled=$false;firstName='Kitting';lastName='Operator';emailVerified=$false;requiredActions=@();attributes=[ordered]@{dleOsPersonaType=@('DEV_TEST_PERSONA');dleOsWorkspace=@('Kitting')}}
        $created=Invoke-Keycloak POST '/admin/realms/dle-os/users' $headers $definition
        if ($created.StatusCode -ne 201 -or $null -eq $created.Headers.Location) { throw 'Keycloak did not create dev.kitting.' }
        $createdSubject=([string]$created.Headers.Location).TrimEnd('/').Split('/')[-1]
        if ([string]::IsNullOrWhiteSpace($createdSubject)) { throw 'Keycloak returned an invalid dev.kitting user location.' }
        [void](Invoke-Keycloak PUT "/admin/realms/dle-os/users/$createdSubject/reset-password" $headers @{type='password';value=$password;temporary=$false})

        $connection=[System.Data.SqlClient.SqlConnection]::new($connectionString)
        try {
            $connection.Open(); $transaction=$connection.BeginTransaction()
            try {
                $command=$connection.CreateCommand();$command.Transaction=$transaction;$command.CommandType=[System.Data.CommandType]::StoredProcedure;$command.CommandText='security.usp_ProvisionDevKittingTestPersona';[void]$command.Parameters.AddWithValue('@KeycloakSubject',$createdSubject)
                try {[void]$command.ExecuteNonQuery()}finally{$command.Dispose()}
                [void](Invoke-Keycloak PUT "/admin/realms/dle-os/users/$createdSubject" $headers @{enabled=$true})
                $keycloakEnabled=$true
                $transaction.Commit()
            }
            catch { try{$transaction.Rollback()}catch{}; throw }
            finally {$transaction.Dispose()}
        }
        catch {
            try {[void](Invoke-Keycloak DELETE "/admin/realms/dle-os/users/$createdSubject" $headers)} catch {}
            throw
        }
        finally {$connection.Dispose()}
    }
    else {
        if ([string]::IsNullOrWhiteSpace($databasePersona.Subject)) { throw 'The existing DLE-OS dev.kitting user has no Keycloak subject.' }
        $createdSubject=$databasePersona.Subject
        [void](Invoke-Keycloak PUT "/admin/realms/dle-os/users/$createdSubject" $headers @{enabled=$true})
        $keycloakEnabled=$true
    }

    $persona=Get-DatabasePersona
    $expectedPermissions=@('kitting.disposition','kitting.view','pick_list.view','rma_rework.view','work_orders.view')
    if (-not $keycloakEnabled) { throw 'dev.kitting was not enabled in Keycloak.' }
    if ($null -eq $persona -or $persona.Subject -ne $createdSubject -or
        $persona.AccountStatus -ne 'ACTIVE' -or $persona.RoleCode -ne 'DEV_KITTING_OPERATOR' -or
        $persona.IsSuperAdmin -or $persona.EmployeeLinks -ne 0) { throw 'The DLE-OS dev.kitting mapping is not qualified.' }
    if (($persona.Permissions -join ',') -ne ($expectedPermissions -join ',')) { throw 'dev.kitting has unexpected effective permissions.' }

    $realAfter=Get-RealIdentitySnapshot
    if (($realBefore|ConvertTo-Json -Compress) -ne ($realAfter|ConvertTo-Json -Compress)) { throw 'A real employee identity changed.' }
    $after=Get-ProtectedSnapshot
    if (($before|ConvertTo-Json -Compress) -ne ($after|ConvertTo-Json -Compress)) { throw 'A protected listener changed.' }
    $evidence.KeycloakEnabled=$true;$evidence.DleOsAccountStatus=$persona.AccountStatus;$evidence.RoleCode=$persona.RoleCode;$evidence.IsSuperAdmin=$persona.IsSuperAdmin;$evidence.Permissions=$persona.Permissions;$evidence.EmployeeLinks=$persona.EmployeeLinks;$evidence.RealIdentitiesAfter=$realAfter;$evidence.ProtectedAfter=$after;$evidence.Verdict='PASS'
}
catch {
    $evidence.Error=$_.Exception.Message
    throw
}
finally {
    $password=$null;$confirmPassword=$null;$clientSecret=$null;$accessToken=$null
    if($secretProtected){[Array]::Clear($secretProtected,0,$secretProtected.Length)}
    if($secretEntropy){[Array]::Clear($secretEntropy,0,$secretEntropy.Length)}
    if($secretPlain){[Array]::Clear($secretPlain,0,$secretPlain.Length)}
    $evidence.CompletedAtUtc=[DateTimeOffset]::UtcNow.ToString('o')
    New-Item -ItemType Directory -Path (Split-Path $evidencePath -Parent) -Force | Out-Null
    $evidence | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $evidencePath -Encoding utf8
}

Write-Host 'dev.kitting provisioning: PASS' -ForegroundColor Green
Write-Host 'No password value was displayed, returned, or recorded.'
