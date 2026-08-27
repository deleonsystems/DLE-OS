[CmdletBinding()]
param(
    [Parameter(Mandatory=$true)]
    [ValidateSet('Preflight','Apply','Rollback')]
    [string]$Mode,

    [Parameter(Mandatory=$true)]
    [string]$EvidenceDirectory,

    [Parameter(Mandatory=$true)]
    [string]$ExpectedScriptSha256
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2.0

[void][Reflection.Assembly]::LoadWithPartialName('System.Security')
[void][Reflection.Assembly]::LoadWithPartialName('System.DirectoryServices')

$ExpectedComputer = 'DELEON-SERVER'
$ExpectedAccount = 'DLE-OS-DEV-FRONTEND'
$ExpectedQualifiedAccount = 'DELEON-SERVER\DLE-OS-DEV-FRONTEND'
$ExpectedAccountSid = 'S-1-5-21-2944932128-830765809-3256817259-1042'
$ExpectedShare = 'Production'
$ExpectedRelativePath = 'Drawing-Prints'
$ShareReadMask = 0x1200A9
$RollbackEntropyText = 'DLE-OS|DRAWING-PRINTS|DIRECTORY-READ|ROLLBACK-V1'
$TransactionScriptPath = $MyInvocation.MyCommand.Path
$PreservedSections = [Security.AccessControl.AccessControlSections]::Access -bor [Security.AccessControl.AccessControlSections]::Owner -bor [Security.AccessControl.AccessControlSections]::Group

function New-Utf8Encoding {
    return New-Object System.Text.UTF8Encoding($false)
}

function Write-Utf8File([string]$Path, [string]$Value) {
    [IO.File]::WriteAllText($Path, $Value, (New-Utf8Encoding))
}

function Get-Sha256Bytes([byte[]]$Bytes) {
    $sha = [Security.Cryptography.SHA256]::Create()
    try {
        return ([BitConverter]::ToString($sha.ComputeHash($Bytes))).Replace('-', '')
    }
    finally {
        $sha.Clear()
    }
}

function Get-Sha256Text([string]$Value) {
    return Get-Sha256Bytes ([Text.Encoding]::UTF8.GetBytes($Value))
}

function Get-Sha256File([string]$Path) {
    $stream = [IO.File]::OpenRead($Path)
    $sha = [Security.Cryptography.SHA256]::Create()
    try {
        return ([BitConverter]::ToString($sha.ComputeHash($stream))).Replace('-', '')
    }
    finally {
        $sha.Clear()
        $stream.Close()
    }
}

function Assert-LocalElevatedServer {
    if ($env:COMPUTERNAME -ine $ExpectedComputer) {
        throw ('This transaction must run locally on ' + $ExpectedComputer + '.')
    }
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($identity)
    if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
        throw 'This transaction requires an elevated local Administrator token.'
    }
}

function Assert-ScriptIntegrity {
    $scriptPath = $TransactionScriptPath
    if ([string]::IsNullOrEmpty($scriptPath)) {
        throw 'The transaction script path cannot be determined.'
    }
    $actual = Get-Sha256File $scriptPath
    if ($actual -ine $ExpectedScriptSha256) {
        throw ('Transaction script checksum mismatch. Expected ' + $ExpectedScriptSha256 + '; actual ' + $actual + '.')
    }
}

function New-RestrictedEvidenceDirectory([string]$Path) {
    if ([IO.Directory]::Exists($Path)) {
        throw ('Evidence directory already exists; refusing to overlay it: ' + $Path)
    }
    [void][IO.Directory]::CreateDirectory($Path)
    $security = New-Object Security.AccessControl.DirectorySecurity
    $security.SetAccessRuleProtection($true, $false)
    $inheritance = [Security.AccessControl.InheritanceFlags]::ContainerInherit -bor [Security.AccessControl.InheritanceFlags]::ObjectInherit
    $propagation = [Security.AccessControl.PropagationFlags]::None
    $allow = [Security.AccessControl.AccessControlType]::Allow
    $full = [Security.AccessControl.FileSystemRights]::FullControl
    $system = New-Object Security.Principal.SecurityIdentifier('S-1-5-18')
    $administrators = New-Object Security.Principal.SecurityIdentifier('S-1-5-32-544')
    $security.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule($system, $full, $inheritance, $propagation, $allow)))
    $security.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule($administrators, $full, $inheritance, $propagation, $allow)))
    [IO.Directory]::SetAccessControl($Path, $security)
}

function Get-ProductionSharePath {
    $share = Get-WmiObject -Class Win32_Share -Filter ("Name='" + $ExpectedShare + "'")
    if ($null -eq $share -or [string]::IsNullOrEmpty([string]$share.Path)) {
        throw 'The governed Production share is absent.'
    }
    return [IO.Path]::GetFullPath([string]$share.Path).TrimEnd('\')
}

function Get-ShareDescriptorRecord {
    $security = Get-WmiObject -Class Win32_LogicalShareSecuritySetting -Filter ("Name='" + $ExpectedShare + "'")
    if ($null -eq $security) {
        throw 'The governed Production share security descriptor is absent.'
    }
    $result = $security.GetSecurityDescriptor()
    if ([int]$result.ReturnValue -ne 0) {
        throw ('Cannot read the Production share security descriptor. Return value: ' + $result.ReturnValue)
    }
    $lines = New-Object Collections.Generic.List[string]
    $matching = New-Object Collections.Generic.List[object]
    foreach ($ace in @($result.Descriptor.DACL)) {
        $trustee = $ace.Trustee
        $sidText = ''
        if ($null -ne $trustee.SID) {
            $sid = New-Object Security.Principal.SecurityIdentifier([byte[]]$trustee.SID, 0)
            $sidText = $sid.Value
        }
        $line = ([string]$ace.AceType) + '|' + ([string]$ace.AccessMask) + '|' + ([string]$ace.AceFlags) + '|' + ([string]$trustee.Domain) + '\' + ([string]$trustee.Name) + '|' + $sidText
        $lines.Add($line)
        if (([string]$trustee.Domain -ieq $ExpectedComputer) -and ([string]$trustee.Name -ieq $ExpectedAccount)) {
            $matching.Add($ace)
        }
    }
    $sorted = @($lines.ToArray() | Sort-Object)
    return New-Object PSObject -Property @{
        Digest = Get-Sha256Text ([string]::Join("`n", $sorted))
        Matching = @($matching.ToArray())
    }
}

function Assert-ExactReadOnlyShareAce($Record) {
    $matchingAces = @($Record.Matching)
    if ($matchingAces.Count -ne 1) {
        throw 'The matched frontend identity does not have exactly one Production share ACE.'
    }
    $ace = $matchingAces[0]
    if ([int]$ace.AceType -ne 0 -or [int]$ace.AccessMask -ne $ShareReadMask) {
        throw 'The matched frontend Production share ACE is not the exact governed read-only ACE.'
    }
}

function Get-AccountSid {
    $sid = New-Object Security.Principal.NTAccount($ExpectedQualifiedAccount)
    $sid = $sid.Translate([Security.Principal.SecurityIdentifier])
    if ($sid.Value -ine $ExpectedAccountSid) {
        throw ('The matched account SID changed. Expected ' + $ExpectedAccountSid + '; actual ' + $sid.Value + '.')
    }
    return $sid
}

function Assert-NoLocalGroupMembership {
    $user = New-Object DirectoryServices.DirectoryEntry('WinNT://' + $ExpectedComputer + '/' + $ExpectedAccount + ',user')
    try {
        [void]$user.NativeObject
        $groups = @($user.Invoke('Groups'))
        if ($groups.Count -ne 0) {
            throw 'The matched frontend identity unexpectedly belongs to a DELEON-SERVER local group.'
        }
    }
    finally {
        $user.Close()
    }
}

function Get-Sddl([string]$Path) {
    return [IO.Directory]::GetAccessControl($Path, $PreservedSections).GetSecurityDescriptorSddlForm($PreservedSections)
}

function Restore-Sddl([string]$Path, [string]$Sddl) {
    $security = [IO.Directory]::GetAccessControl($Path, $PreservedSections)
    $security.SetSecurityDescriptorSddlForm($Sddl, $PreservedSections)
    [IO.Directory]::SetAccessControl($Path, $security)
}

function Get-SidRules([string]$Path, [Security.Principal.SecurityIdentifier]$Sid, [bool]$IncludeInherited) {
    $security = [IO.Directory]::GetAccessControl($Path, [Security.AccessControl.AccessControlSections]::Access)
    $rules = $security.GetAccessRules($true, $IncludeInherited, [Security.Principal.SecurityIdentifier])
    $matches = New-Object Collections.Generic.List[object]
    foreach ($rule in $rules) {
        if ($Sid.Equals($rule.IdentityReference)) {
            $matches.Add($rule)
        }
    }
    return @($matches.ToArray())
}

function Assert-NoUnrelatedDirectAces([string]$SharePath, [Security.Principal.SecurityIdentifier]$Sid) {
    $productionRootRules = @(Get-SidRules $SharePath $Sid $true)
    if ($productionRootRules.Count -ne 0) {
        throw 'The matched frontend identity unexpectedly has an ACE on the Production root.'
    }
    foreach ($directory in [IO.Directory]::GetDirectories($SharePath)) {
        $name = [IO.Path]::GetFileName($directory)
        if ($name -ieq 'KITTING' -or $name -ieq $ExpectedRelativePath) {
            continue
        }
        $unrelatedRules = @(Get-SidRules $directory $Sid $true)
        if ($unrelatedRules.Count -ne 0) {
            throw ('The matched frontend identity unexpectedly has an ACE on unrelated Production path ' + $name + '.')
        }
    }
}

function Get-UnrelatedAclDigest([string]$SharePath) {
    $lines = New-Object Collections.Generic.List[string]
    $lines.Add('.|' + (Get-Sddl $SharePath))
    foreach ($directory in @([IO.Directory]::GetDirectories($SharePath) | Sort-Object)) {
        if ([IO.Path]::GetFileName($directory) -ieq $ExpectedRelativePath) {
            continue
        }
        $relative = $directory.Substring($SharePath.Length).TrimStart('\')
        $lines.Add($relative + '|' + (Get-Sddl $directory))
    }
    return Get-Sha256Text ([string]::Join("`n", $lines.ToArray()))
}

function Get-StructureInventory([string]$Root) {
    if (([IO.File]::GetAttributes($Root) -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
        throw 'The governed Drawing-Prints root must not be a reparse point.'
    }
    $lines = New-Object Collections.Generic.List[string]
    $directories = New-Object Collections.Generic.Stack[string]
    $directories.Push($Root)
    $directoryCount = 0
    $fileCount = 0
    while ($directories.Count -gt 0) {
        $current = $directories.Pop()
        foreach ($directory in [IO.Directory]::GetDirectories($current)) {
            $info = New-Object IO.DirectoryInfo($directory)
            if (($info.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
                throw ('Drawing-Prints contains a reparse-point directory; refusing to traverse it: ' + $directory)
            }
            $relative = $directory.Substring($Root.Length).TrimStart('\')
            $lines.Add('D|' + $relative + '|' + $info.LastWriteTimeUtc.Ticks)
            $directoryCount++
            $directories.Push($directory)
        }
        foreach ($file in [IO.Directory]::GetFiles($current)) {
            $info = New-Object IO.FileInfo($file)
            $relative = $file.Substring($Root.Length).TrimStart('\')
            $lines.Add('F|' + $relative + '|' + $info.Length + '|' + $info.LastWriteTimeUtc.Ticks)
            $fileCount++
        }
    }
    $sorted = @($lines.ToArray() | Sort-Object)
    $rootInfo = New-Object IO.DirectoryInfo($Root)
    return New-Object PSObject -Property @{
        DirectoryCount = $directoryCount
        FileCount = $fileCount
        RootLastWriteTimeUtc = $rootInfo.LastWriteTimeUtc.ToString('o')
        Digest = Get-Sha256Text ([string]::Join("`n", $sorted))
    }
}

function Write-Evidence([string]$Path, [hashtable]$Values) {
    $lines = New-Object Collections.Generic.List[string]
    foreach ($key in @($Values.Keys | Sort-Object)) {
        $value = [string]$Values[$key]
        $lines.Add(([string]$key) + '=' + $value.Replace("`r", '').Replace("`n", '\n'))
    }
    Write-Utf8File $Path ([string]::Join("`r`n", $lines.ToArray()) + "`r`n")
    Write-Utf8File ($Path + '.sha256') ((Get-Sha256File $Path) + "`r`n")
}

function Protect-RollbackState([string]$Path, [string]$TransactionId, [string]$Sddl) {
    $plainText = 'TransactionId=' + $TransactionId + "`n" + 'SddlBase64=' + [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($Sddl)) + "`n"
    $plain = [Text.Encoding]::UTF8.GetBytes($plainText)
    $entropy = [Text.Encoding]::UTF8.GetBytes($RollbackEntropyText)
    $cipher = $null
    try {
        $cipher = [Security.Cryptography.ProtectedData]::Protect($plain, $entropy, [Security.Cryptography.DataProtectionScope]::LocalMachine)
        [IO.File]::WriteAllBytes($Path, $cipher)
        Write-Utf8File ($Path + '.sha256') ((Get-Sha256File $Path) + "`r`n")
    }
    finally {
        if ($null -ne $plain) { [Array]::Clear($plain, 0, $plain.Length) }
        if ($null -ne $entropy) { [Array]::Clear($entropy, 0, $entropy.Length) }
        if ($null -ne $cipher) { [Array]::Clear($cipher, 0, $cipher.Length) }
    }
}

function Read-RollbackSddl([string]$Path) {
    $expected = ([IO.File]::ReadAllText($Path + '.sha256')).Trim()
    if ((Get-Sha256File $Path) -ine $expected) {
        throw 'Rollback state checksum mismatch.'
    }
    $cipher = [IO.File]::ReadAllBytes($Path)
    $entropy = [Text.Encoding]::UTF8.GetBytes($RollbackEntropyText)
    $plain = $null
    try {
        $plain = [Security.Cryptography.ProtectedData]::Unprotect($cipher, $entropy, [Security.Cryptography.DataProtectionScope]::LocalMachine)
        $text = [Text.Encoding]::UTF8.GetString($plain)
        foreach ($line in $text.Split("`n")) {
            if ($line.StartsWith('SddlBase64=')) {
                return [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($line.Substring(11).Trim()))
            }
        }
        throw 'Rollback state does not contain the protected pre-change SDDL.'
    }
    finally {
        if ($null -ne $cipher) { [Array]::Clear($cipher, 0, $cipher.Length) }
        if ($null -ne $entropy) { [Array]::Clear($entropy, 0, $entropy.Length) }
        if ($null -ne $plain) { [Array]::Clear($plain, 0, $plain.Length) }
    }
}

function Add-DirectoryEnumerationRule([string]$Path, [Security.Principal.SecurityIdentifier]$Sid) {
    $security = [IO.Directory]::GetAccessControl($Path, [Security.AccessControl.AccessControlSections]::Access)
    $rights = [Security.AccessControl.FileSystemRights]::ReadAndExecute
    $inheritance = [Security.AccessControl.InheritanceFlags]::ContainerInherit
    $propagation = [Security.AccessControl.PropagationFlags]::None
    $allow = [Security.AccessControl.AccessControlType]::Allow
    $rule = New-Object Security.AccessControl.FileSystemAccessRule($Sid, $rights, $inheritance, $propagation, $allow)
    $security.AddAccessRule($rule)
    [IO.Directory]::SetAccessControl($Path, $security)
}

function Assert-ExactDirectoryEnumerationRule([string]$Path, [Security.Principal.SecurityIdentifier]$Sid) {
    $matches = @(Get-SidRules $Path $Sid $false)
    if ($matches.Count -ne 1) {
        throw 'Drawing-Prints does not contain exactly one explicit matched-account ACE.'
    }
    $rule = $matches[0]
    $required = [long]([Security.AccessControl.FileSystemRights]::ReadAndExecute -bor [Security.AccessControl.FileSystemRights]::Synchronize)
    $actual = [long]$rule.FileSystemRights
    $forbidden = [long]([Security.AccessControl.FileSystemRights]::WriteData -bor [Security.AccessControl.FileSystemRights]::AppendData -bor [Security.AccessControl.FileSystemRights]::WriteExtendedAttributes -bor [Security.AccessControl.FileSystemRights]::WriteAttributes -bor [Security.AccessControl.FileSystemRights]::DeleteSubdirectoriesAndFiles -bor [Security.AccessControl.FileSystemRights]::Delete -bor [Security.AccessControl.FileSystemRights]::ChangePermissions -bor [Security.AccessControl.FileSystemRights]::TakeOwnership)
    if ($rule.AccessControlType -ne [Security.AccessControl.AccessControlType]::Allow -or
        (($actual -band $required) -ne $required) -or (($actual -band $forbidden) -ne 0) -or
        $rule.InheritanceFlags -ne [Security.AccessControl.InheritanceFlags]::ContainerInherit -or
        $rule.PropagationFlags -ne [Security.AccessControl.PropagationFlags]::None) {
        throw 'Drawing-Prints directory-enumeration ACE is not the exact approved rule.'
    }
}

function Assert-AllDirectoriesEnumerable([string]$Root, [Security.Principal.SecurityIdentifier]$Sid) {
    $directories = New-Object Collections.Generic.Stack[string]
    $directories.Push($Root)
    $required = [long]([Security.AccessControl.FileSystemRights]::ReadAndExecute -bor [Security.AccessControl.FileSystemRights]::Synchronize)
    $forbidden = [long]([Security.AccessControl.FileSystemRights]::WriteData -bor [Security.AccessControl.FileSystemRights]::AppendData -bor [Security.AccessControl.FileSystemRights]::WriteExtendedAttributes -bor [Security.AccessControl.FileSystemRights]::WriteAttributes -bor [Security.AccessControl.FileSystemRights]::DeleteSubdirectoriesAndFiles -bor [Security.AccessControl.FileSystemRights]::Delete -bor [Security.AccessControl.FileSystemRights]::ChangePermissions -bor [Security.AccessControl.FileSystemRights]::TakeOwnership)
    while ($directories.Count -gt 0) {
        $current = $directories.Pop()
        $usable = $false
        foreach ($rule in @(Get-SidRules $current $Sid $true)) {
            $actual = [long]$rule.FileSystemRights
            if ($rule.AccessControlType -eq [Security.AccessControl.AccessControlType]::Allow -and
                (($actual -band $required) -eq $required) -and (($actual -band $forbidden) -eq 0)) {
                $usable = $true
            }
        }
        if (-not $usable) {
            throw ('A protected or divergent child ACL prevents the approved directory-enumeration rule from reaching ' + $current + '.')
        }
        foreach ($child in [IO.Directory]::GetDirectories($current)) {
            if (([IO.File]::GetAttributes($child) -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
                throw ('Drawing-Prints contains a reparse-point directory; refusing to traverse it: ' + $child)
            }
            $directories.Push($child)
        }
    }
}

Assert-LocalElevatedServer
Assert-ScriptIntegrity

$sharePath = Get-ProductionSharePath
$targetPath = [IO.Path]::Combine($sharePath, $ExpectedRelativePath)
if (-not [IO.Directory]::Exists($targetPath)) {
    throw ('The governed Drawing-Prints directory is absent: ' + $targetPath)
}
$sid = Get-AccountSid

if ($Mode -eq 'Preflight') {
    Assert-NoLocalGroupMembership
    $preflightShare = Get-ShareDescriptorRecord
    Assert-ExactReadOnlyShareAce $preflightShare
    Assert-NoUnrelatedDirectAces $sharePath $sid
    $preflightTargetRules = @(Get-SidRules $targetPath $sid $true)
    if ($preflightTargetRules.Count -ne 0) {
        throw 'Drawing-Prints already contains an ACE for the matched frontend identity.'
    }
    $preflightInventory = Get-StructureInventory $targetPath
    [void](Get-UnrelatedAclDigest $sharePath)
    Write-Output 'Drawing-Prints directory-read transaction preflight: PASS'
    Write-Output ('Directories=' + $preflightInventory.DirectoryCount + '; Files=' + $preflightInventory.FileCount + '; Digest=' + $preflightInventory.Digest)
    exit 0
}

if ($Mode -eq 'Rollback') {
    $statePath = [IO.Path]::Combine($EvidenceDirectory, 'rollback-state.dpapi')
    if (-not [IO.File]::Exists($statePath)) {
        throw 'The protected rollback state is absent.'
    }
    $before = Get-StructureInventory $targetPath
    $sddl = Read-RollbackSddl $statePath
    Restore-Sddl $targetPath $sddl
    $after = Get-StructureInventory $targetPath
    if ($before.Digest -ine $after.Digest -or $before.DirectoryCount -ne $after.DirectoryCount -or $before.FileCount -ne $after.FileCount) {
        throw 'Drawing-Prints content changed during ACL rollback.'
    }
    Write-Evidence ([IO.Path]::Combine($EvidenceDirectory, 'rollback-result.txt')) @{
        Verdict='PASS';Computer=$env:COMPUTERNAME;Account=$ExpectedQualifiedAccount;Sid=$sid.Value
        Target=$targetPath;RestoredSddlSha256=(Get-Sha256Text $sddl);ContentDigest=$after.Digest
        DirectoryCount=$after.DirectoryCount;FileCount=$after.FileCount;CompletedAtUtc=[DateTimeOffset]::UtcNow.ToString('o')
    }
    Write-Output 'Drawing-Prints directory-read ACL rollback: PASS'
    exit 0
}

New-RestrictedEvidenceDirectory $EvidenceDirectory
$transactionId = [IO.Path]::GetFileName($EvidenceDirectory.TrimEnd('\'))
$mutationStarted = $false
$preSddl = $null
try {
    Assert-NoLocalGroupMembership
    $shareBefore = Get-ShareDescriptorRecord
    Assert-ExactReadOnlyShareAce $shareBefore
    Assert-NoUnrelatedDirectAces $sharePath $sid
    $applyTargetRules = @(Get-SidRules $targetPath $sid $true)
    if ($applyTargetRules.Count -ne 0) {
        throw 'Drawing-Prints already contains an ACE for the matched frontend identity; refusing to overlay it.'
    }

    $inventoryBefore = Get-StructureInventory $targetPath
    $unrelatedBefore = Get-UnrelatedAclDigest $sharePath
    $preSddl = Get-Sddl $targetPath
    Protect-RollbackState ([IO.Path]::Combine($EvidenceDirectory, 'rollback-state.dpapi')) $transactionId $preSddl
    Write-Evidence ([IO.Path]::Combine($EvidenceDirectory, 'pre-change.txt')) @{
        TransactionId=$transactionId;Computer=$env:COMPUTERNAME;Account=$ExpectedQualifiedAccount;Sid=$sid.Value
        Share=$ExpectedShare;SharePath=$sharePath;ShareAclDigest=$shareBefore.Digest;Target=$targetPath
        TargetSddl=$preSddl;TargetSddlSha256=(Get-Sha256Text $preSddl);DirectoryCount=$inventoryBefore.DirectoryCount
        FileCount=$inventoryBefore.FileCount;RootLastWriteTimeUtc=$inventoryBefore.RootLastWriteTimeUtc
        ContentMetadataDigest=$inventoryBefore.Digest;UnrelatedProductionAclDigest=$unrelatedBefore
        CapturedAtUtc=[DateTimeOffset]::UtcNow.ToString('o')
    }

    $mutationStarted = $true
    Add-DirectoryEnumerationRule $targetPath $sid
    Assert-ExactDirectoryEnumerationRule $targetPath $sid
    Assert-AllDirectoriesEnumerable $targetPath $sid
    Assert-NoUnrelatedDirectAces $sharePath $sid

    $shareAfter = Get-ShareDescriptorRecord
    Assert-ExactReadOnlyShareAce $shareAfter
    $inventoryAfter = Get-StructureInventory $targetPath
    $unrelatedAfter = Get-UnrelatedAclDigest $sharePath
    if ($shareAfter.Digest -ine $shareBefore.Digest) { throw 'Production share permissions changed unexpectedly.' }
    if ($unrelatedAfter -ine $unrelatedBefore) { throw 'An unrelated Production ACL changed unexpectedly.' }
    if ($inventoryAfter.Digest -ine $inventoryBefore.Digest -or
        $inventoryAfter.DirectoryCount -ne $inventoryBefore.DirectoryCount -or
        $inventoryAfter.FileCount -ne $inventoryBefore.FileCount -or
        $inventoryAfter.RootLastWriteTimeUtc -ine $inventoryBefore.RootLastWriteTimeUtc) {
        throw 'Drawing-Prints content metadata changed during the ACL transaction.'
    }
    $postSddl = Get-Sddl $targetPath
    Write-Evidence ([IO.Path]::Combine($EvidenceDirectory, 'post-change.txt')) @{
        Verdict='PASS';TransactionId=$transactionId;Computer=$env:COMPUTERNAME;Account=$ExpectedQualifiedAccount;Sid=$sid.Value
        Target=$targetPath;PreSddlSha256=(Get-Sha256Text $preSddl);PostSddl=$postSddl;PostSddlSha256=(Get-Sha256Text $postSddl)
        Rights='ReadAndExecute (directory traversal/list/read attributes/read permissions)';Inheritance='ContainerInherit only'
        ObjectInherit='False';FileContentReadGranted='False';MutationRightsGranted='False';ShareAclChanged='False'
        ShareAclDigest=$shareAfter.Digest;UnrelatedProductionAclChanged='False';UnrelatedProductionAclDigest=$unrelatedAfter
        DirectoryCount=$inventoryAfter.DirectoryCount;FileCount=$inventoryAfter.FileCount
        RootLastWriteTimeUtc=$inventoryAfter.RootLastWriteTimeUtc;ContentMetadataDigest=$inventoryAfter.Digest
        CompletedAtUtc=[DateTimeOffset]::UtcNow.ToString('o')
    }
    Write-Output 'Drawing-Prints directory-read ACL transaction: PASS'
    Write-Output ('Evidence: ' + $EvidenceDirectory)
    exit 0
}
catch {
    $rollbackVerdict = 'NOT_REQUIRED'
    $rollbackError = ''
    if ($mutationStarted -and $null -ne $preSddl) {
        try {
            Restore-Sddl $targetPath $preSddl
            $rollbackVerdict = 'PASS'
        }
        catch {
            $rollbackVerdict = 'FAIL'
            $rollbackError = $_.Exception.Message
        }
    }
    Write-Evidence ([IO.Path]::Combine($EvidenceDirectory, 'failure.txt')) @{
        Verdict='FAIL';TransactionId=$transactionId;Computer=$env:COMPUTERNAME;Target=$targetPath
        Error=$_.Exception.Message;MutationStarted=$mutationStarted;AutomaticRollback=$rollbackVerdict
        RollbackError=$rollbackError;CompletedAtUtc=[DateTimeOffset]::UtcNow.ToString('o')
    }
    if ($rollbackVerdict -eq 'FAIL') {
        throw ($_.Exception.Message + ' Automatic rollback also failed: ' + $rollbackError)
    }
    throw
}
