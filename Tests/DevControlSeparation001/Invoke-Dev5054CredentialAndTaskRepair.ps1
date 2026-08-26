[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
if (-not ([Security.Principal.WindowsPrincipal]::new($identity)).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'Elevation required.' }

$accountName = 'DLE-OS-DEV-CONTROL'
$runtimeIdentity = 'DLE-OS-HOST\DLE-OS-DEV-CONTROL'
$candidatePath = '\'
$candidateName = 'DLE-OS DEV Operational ControlHost 5054 Candidate'
$legacyPath = '\DLE-OS\Development\'
$legacyName = 'Operational ControlHost 5054'
$release = 'C:\DLE-OS\Development\OperationalControlHost5054\Releases\dev5054-20260825T170328Z-4e01176a73ea'
$launcher = Join-Path $release 'Start-DevOperationalControlHost5054.ps1'
$executable = Join-Path $release 'DleOs.DevOperationalControlHost.exe'
$manifestPath = 'C:\DLE-OS\Development\OperationalControlHost5054\Manifests\dev5054-20260825T170328Z-4e01176a73ea.json'
$expectedLegacyHash = 'A8599487E42C55F796CC24D499CBFD960DDDD7543CE258CCA2C38CA148342CE9'
$outputPath = Join-Path $PSScriptRoot 'dev5054-credential-task-repair.json'

function Get-TextSha256([string]$Text) {
    $sha = [Security.Cryptography.SHA256]::Create()
    try { return ([BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::Unicode.GetBytes($Text)))).Replace('-', '') }
    finally { $sha.Dispose() }
}
function Get-CanonicalTaskXml([string]$Text, [bool]$NormalizeLimit) {
    [xml]$xml = $Text
    $ns = [Xml.XmlNamespaceManager]::new($xml.NameTable)
    $ns.AddNamespace('t', 'http://schemas.microsoft.com/windows/2004/02/mit/task')
    $node = $xml.SelectSingleNode('/t:Task/t:Settings/t:ExecutionTimeLimit', $ns)
    if (-not $node) { throw 'ExecutionTimeLimit is absent from the candidate XML.' }
    if ($NormalizeLimit) { $node.InnerText = '<EXECUTION_TIME_LIMIT>' }
    return $xml.OuterXml
}
function Get-UserRights([string]$AccountSid) {
    $temporary = Join-Path $env:TEMP ('dle-os-user-rights-{0}.inf' -f [guid]::NewGuid())
    try {
        & secedit.exe /export /cfg $temporary /areas USER_RIGHTS /quiet | Out-Null
        if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $temporary)) { throw "secedit USER_RIGHTS export failed with exit code $LASTEXITCODE." }
        $content = Get-Content -LiteralPath $temporary
        $principals = @("*$AccountSid", $accountName, $runtimeIdentity, '*S-1-5-32-545', 'Users')
        $result = [ordered]@{}
        foreach ($right in 'SeDenyInteractiveLogonRight','SeDenyRemoteInteractiveLogonRight','SeDenyNetworkLogonRight','SeBatchLogonRight') {
            $line = @($content | Where-Object { $_ -match ('^' + [regex]::Escape($right) + '\s*=') }) | Select-Object -First 1
            $assigned = @()
            if ($line) { $assigned = @(($line -split '=',2)[1].Split(',') | ForEach-Object { $_.Trim() } | Where-Object { $_ }) }
            $result[$right] = [ordered]@{ Assigned = $assigned; Applies = @($assigned | Where-Object { $_ -in $principals }).Count -gt 0 }
        }
        return $result
    }
    finally { Remove-Item -LiteralPath $temporary -Force -ErrorAction SilentlyContinue }
}
function Get-AccountGroups([string]$QualifiedName) {
    @(Get-LocalGroup | ForEach-Object {
        $group = $_
        if (Get-LocalGroupMember -Group $group.Name -ErrorAction SilentlyContinue | Where-Object { $_.Name -ieq $QualifiedName }) { $group.Name }
    } | Sort-Object)
}
function Get-ReleaseIntegrity {
    $manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
    @($manifest.files | ForEach-Object {
        $path = Join-Path $release $_.relativePath
        [ordered]@{ RelativePath = $_.relativePath; ExpectedSha256 = $_.sha256; ActualSha256 = (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash; ExpectedLength = [int64]$_.length; ActualLength = (Get-Item -LiteralPath $path).Length }
    })
}
function Get-MutationAclFindings([string]$AccountSid) {
    $mutationMask = [Security.AccessControl.FileSystemRights]::WriteData -bor
        [Security.AccessControl.FileSystemRights]::AppendData -bor
        [Security.AccessControl.FileSystemRights]::CreateFiles -bor
        [Security.AccessControl.FileSystemRights]::CreateDirectories -bor
        [Security.AccessControl.FileSystemRights]::Delete -bor
        [Security.AccessControl.FileSystemRights]::DeleteSubdirectoriesAndFiles -bor
        [Security.AccessControl.FileSystemRights]::ChangePermissions -bor
        [Security.AccessControl.FileSystemRights]::TakeOwnership -bor
        [Security.AccessControl.FileSystemRights]::WriteAttributes -bor
        [Security.AccessControl.FileSystemRights]::WriteExtendedAttributes
    $targets = @((Get-Item -LiteralPath $release)) + @(Get-ChildItem -LiteralPath $release -Recurse -Force)
    @($targets | ForEach-Object {
        $path = $_.FullName
        $rules = (Get-Acl -LiteralPath $path).Access
        $bad = @($rules | Where-Object {
            $_.AccessControlType -eq 'Allow' -and
            ($_.IdentityReference.Value -ieq $runtimeIdentity -or $_.IdentityReference.Value -ieq 'BUILTIN\Users' -or $_.IdentityReference.Value -eq $AccountSid) -and
            (($_.FileSystemRights -band $mutationMask) -ne 0)
        })
        if ($bad.Count) { [ordered]@{ Path = $path; Rules = @($bad | Select-Object IdentityReference, FileSystemRights, IsInherited) } }
    })
}

$account = Get-LocalUser -Name $accountName
$accountSid = [string]$account.Sid
$groupsBefore = @(Get-AccountGroups $runtimeIdentity)
$rightsBefore = Get-UserRights $accountSid
$taskBefore = Get-ScheduledTask -TaskPath $candidatePath -TaskName $candidateName
$taskInfoBefore = Get-ScheduledTaskInfo -TaskPath $candidatePath -TaskName $candidateName
$taskXmlBefore = Export-ScheduledTask -TaskPath $candidatePath -TaskName $candidateName
$legacyXmlBefore = Export-ScheduledTask -TaskPath $legacyPath -TaskName $legacyName
$legacyHashBefore = Get-TextSha256 $legacyXmlBefore
$filesBefore = @(Get-ReleaseIntegrity)
$aclFindingsBefore = @(Get-MutationAclFindings $accountSid)
$action = @($taskBefore.Actions)[0]
$candidateSid = [string]([Security.Principal.NTAccount]::new($taskBefore.Principal.UserId).Translate([Security.Principal.SecurityIdentifier]))

$preflightPassed = $account.Enabled -and
    $groupsBefore.Count -eq 1 -and $groupsBefore[0] -eq 'Users' -and
    $rightsBefore.SeDenyInteractiveLogonRight.Applies -and
    $rightsBefore.SeDenyRemoteInteractiveLogonRight.Applies -and
    $rightsBefore.SeDenyNetworkLogonRight.Applies -and
    $rightsBefore.SeBatchLogonRight.Applies -and
    $taskBefore.State -eq 'Disabled' -and -not $taskBefore.Settings.Enabled -and
    $candidateSid -eq $accountSid -and [string]$taskBefore.Principal.LogonType -eq 'Password' -and [string]$taskBefore.Principal.RunLevel -eq 'Limited' -and
    [string]$taskBefore.Settings.ExecutionTimeLimit -eq 'PT5M' -and
    $action.Execute -ieq 'powershell.exe' -and $action.Arguments -match [regex]::Escape($launcher) -and $action.WorkingDirectory -ieq $release -and
    $legacyHashBefore -eq $expectedLegacyHash -and
    $filesBefore.Count -eq 47 -and @($filesBefore | Where-Object { $_.ExpectedSha256 -ne $_.ActualSha256 -or $_.ExpectedLength -ne $_.ActualLength }).Count -eq 0 -and
    $aclFindingsBefore.Count -eq 0 -and
    @(Get-NetTCPConnection -State Listen -LocalPort 5054 -ErrorAction SilentlyContinue).Count -eq 0
if (-not $preflightPassed) {
    [ordered]@{ Schema='dle-os.dev5054-credential-task-repair.v1'; CapturedUtc=[DateTimeOffset]::UtcNow; PreflightPassed=$false; AccountEnabled=$account.Enabled; AccountSid=$accountSid; Groups=$groupsBefore; UserRights=$rightsBefore; CandidateState=[string]$taskBefore.State; CandidateEnabled=[bool]$taskBefore.Settings.Enabled; ExecutionTimeLimit=[string]$taskBefore.Settings.ExecutionTimeLimit; CandidateUser=$taskBefore.Principal.UserId; CandidateAction=$action; LegacyHash=$legacyHashBefore; ReleaseFileCount=$filesBefore.Count; ReleaseMismatchCount=@($filesBefore|Where-Object{$_.ExpectedSha256-ne$_.ActualSha256-or$_.ExpectedLength-ne$_.ActualLength}).Count; AclMutationFindings=$aclFindingsBefore; ListenerCount=@(Get-NetTCPConnection -State Listen -LocalPort 5054 -ErrorAction SilentlyContinue).Count } | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath $outputPath -Encoding utf8
    throw 'Credential/task repair preflight failed; no credential or task state changed.'
}

Write-Host ''
Write-Host 'Enter the operator-controlled password for DLE-OS-DEV-CONTROL.' -ForegroundColor Cyan
Write-Host 'Input is masked and will not be logged or written to evidence.' -ForegroundColor Cyan
$secureOne = Read-Host 'New password' -AsSecureString
$secureTwo = Read-Host 'Confirm new password' -AsSecureString
$bstrOne = [IntPtr]::Zero
$bstrTwo = [IntPtr]::Zero
$plainOne = $null
$plainTwo = $null
try {
    $bstrOne = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureOne)
    $bstrTwo = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureTwo)
    $plainOne = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstrOne)
    $plainTwo = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstrTwo)
    if ([string]::IsNullOrWhiteSpace($plainOne) -or $plainOne -cne $plainTwo) { throw 'The securely entered passwords did not match.' }

    Set-LocalUser -Name $accountName -Password $secureOne
    [xml]$updatedXmlDocument = $taskXmlBefore
    $ns = [Xml.XmlNamespaceManager]::new($updatedXmlDocument.NameTable)
    $ns.AddNamespace('t', 'http://schemas.microsoft.com/windows/2004/02/mit/task')
    $limitNode = $updatedXmlDocument.SelectSingleNode('/t:Task/t:Settings/t:ExecutionTimeLimit', $ns)
    $limitNode.InnerText = 'PT0S'
    $updatedXml = $updatedXmlDocument.OuterXml
    Register-ScheduledTask -TaskPath $candidatePath -TaskName $candidateName -Xml $updatedXml -User $runtimeIdentity -Password $plainOne -Force | Out-Null
}
finally {
    $plainOne = $null
    $plainTwo = $null
    if ($bstrOne -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstrOne) }
    if ($bstrTwo -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstrTwo) }
    if ($secureOne) { $secureOne.Dispose() }
    if ($secureTwo) { $secureTwo.Dispose() }
}

$taskAfterRegistration = Get-ScheduledTask -TaskPath $candidatePath -TaskName $candidateName
$taskXmlAfterRegistration = Export-ScheduledTask -TaskPath $candidatePath -TaskName $candidateName
$legacyXmlAfterRegistration = Export-ScheduledTask -TaskPath $legacyPath -TaskName $legacyName
$groupsAfter = @(Get-AccountGroups $runtimeIdentity)
$rightsAfter = Get-UserRights $accountSid
$onlyLimitChanged = (Get-CanonicalTaskXml $taskXmlBefore $true) -ceq (Get-CanonicalTaskXml $taskXmlAfterRegistration $true)
$boundaryPreserved = $groupsAfter.Count -eq 1 -and $groupsAfter[0] -eq 'Users' -and
    $rightsAfter.SeDenyInteractiveLogonRight.Applies -and $rightsAfter.SeDenyRemoteInteractiveLogonRight.Applies -and
    $rightsAfter.SeDenyNetworkLogonRight.Applies -and $rightsAfter.SeBatchLogonRight.Applies -and
    [string](Get-LocalUser $accountName).Sid -eq $accountSid -and @(Get-MutationAclFindings $accountSid).Count -eq 0
if (-not $onlyLimitChanged -or [string]$taskAfterRegistration.Settings.ExecutionTimeLimit -ne 'PT0S' -or -not $boundaryPreserved -or (Get-TextSha256 $legacyXmlAfterRegistration) -ne $legacyHashBefore) {
    Disable-ScheduledTask -TaskPath $candidatePath -TaskName $candidateName -ErrorAction SilentlyContinue | Out-Null
    throw 'Post-registration integrity validation failed; the candidate remains disabled.'
}

$ciStart = (Get-WinEvent -LogName 'Microsoft-Windows-CodeIntegrity/Operational' -MaxEvents 1 -ErrorAction SilentlyContinue).RecordId
$defenderStart = (Get-WinEvent -LogName 'Microsoft-Windows-Windows Defender/Operational' -MaxEvents 1 -ErrorAction SilentlyContinue).RecordId
$startedUtc = [DateTimeOffset]::UtcNow
Enable-ScheduledTask -TaskPath $candidatePath -TaskName $candidateName | Out-Null
Start-ScheduledTask -TaskPath $candidatePath -TaskName $candidateName
$deadline = (Get-Date).AddSeconds(30)
do { Start-Sleep -Milliseconds 500; $listener = @(Get-NetTCPConnection -State Listen -LocalPort 5054 -ErrorAction SilentlyContinue) } while ($listener.Count -eq 0 -and (Get-Date) -lt $deadline)
if ($listener.Count -eq 0) {
    Stop-ScheduledTask -TaskPath $candidatePath -TaskName $candidateName -ErrorAction SilentlyContinue
    Disable-ScheduledTask -TaskPath $candidatePath -TaskName $candidateName -ErrorAction SilentlyContinue | Out-Null
    throw 'The repaired candidate did not open TCP 5054; it was stopped and disabled.'
}
$processes = @(Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -and $_.ExecutablePath -ieq $executable } | ForEach-Object {
    $owner = Invoke-CimMethod -InputObject $_ -MethodName GetOwner
    [ordered]@{ ProcessId=[int]$_.ProcessId; ParentProcessId=[int]$_.ParentProcessId; ExecutablePath=$_.ExecutablePath; CommandLine=$_.CommandLine; CreationDate=$_.CreationDate; Owner="$($owner.Domain)\$($owner.User)" }
})
$startupPassed = $processes.Count -eq 1 -and $processes[0].Owner -ieq $runtimeIdentity -and $processes[0].ExecutablePath -ieq $executable
if (-not $startupPassed) {
    Stop-ScheduledTask -TaskPath $candidatePath -TaskName $candidateName -ErrorAction SilentlyContinue
    Disable-ScheduledTask -TaskPath $candidatePath -TaskName $candidateName -ErrorAction SilentlyContinue | Out-Null
    throw 'The repaired candidate process identity/path check failed; it was stopped and disabled.'
}

$result = [ordered]@{
    Schema='dle-os.dev5054-credential-task-repair.v1'; CapturedUtc=[DateTimeOffset]::UtcNow; StartedUtc=$startedUtc; ElevatedIdentity=$identity.Name
    PreflightPassed=$preflightPassed; CredentialRefreshed=$true; CredentialPersistedInEvidence=$false; AccountSidBefore=$accountSid; AccountSidAfter=[string](Get-LocalUser $accountName).Sid
    GroupsBefore=$groupsBefore; GroupsAfter=$groupsAfter; UserRightsBefore=$rightsBefore; UserRightsAfter=$rightsAfter; LeastPrivilegeBoundaryPreserved=$boundaryPreserved
    CandidateXmlSha256Before=Get-TextSha256 $taskXmlBefore; CandidateXmlSha256AfterRegistration=Get-TextSha256 $taskXmlAfterRegistration; OnlyExecutionTimeLimitChanged=$onlyLimitChanged
    ExecutionTimeLimitBefore='PT5M'; ExecutionTimeLimitAfter=[string]$taskAfterRegistration.Settings.ExecutionTimeLimit
    LegacyHashBefore=$legacyHashBefore; LegacyHashAfter=Get-TextSha256 $legacyXmlAfterRegistration; LegacyUnchanged=(Get-TextSha256 $legacyXmlAfterRegistration)-eq$legacyHashBefore
    ReleaseFileCount=$filesBefore.Count; ReleaseMismatchCount=0; AclMutationFindings=$aclFindingsBefore
    CandidateState=[string](Get-ScheduledTask -TaskPath $candidatePath -TaskName $candidateName).State; CandidateEnabled=[bool](Get-ScheduledTask -TaskPath $candidatePath -TaskName $candidateName).Settings.Enabled
    Listener=@($listener|Select-Object LocalAddress,LocalPort,OwningProcess); Processes=$processes
    CodeIntegrityEvents=@(Get-WinEvent -FilterHashtable @{LogName='Microsoft-Windows-CodeIntegrity/Operational';StartTime=$startedUtc.LocalDateTime} -ErrorAction SilentlyContinue|Where-Object{$_.RecordId-gt$ciStart-and$_.Message-match'DleOs\.DevOperationalControlHost|dev5054-20260825T170328Z-4e01176a73ea'}|Select-Object TimeCreated,RecordId,Id,LevelDisplayName,Message)
    DefenderEvents=@(Get-WinEvent -FilterHashtable @{LogName='Microsoft-Windows-Windows Defender/Operational';StartTime=$startedUtc.LocalDateTime} -ErrorAction SilentlyContinue|Where-Object{$_.RecordId-gt$defenderStart-and$_.Message-match'DleOs\.DevOperationalControlHost|dev5054-20260825T170328Z-4e01176a73ea'}|Select-Object TimeCreated,RecordId,Id,LevelDisplayName,Message)
    PasswordPrinted=$false; PasswordWrittenToEvidence=$false; Passed=$true
}
$result | ConvertTo-Json -Depth 14 | Set-Content -LiteralPath $outputPath -Encoding utf8
Write-Host ''
Write-Host 'Credential/task repair and initial candidate startup passed.' -ForegroundColor Green
Write-Host 'The password was not printed or written to evidence.' -ForegroundColor Green
