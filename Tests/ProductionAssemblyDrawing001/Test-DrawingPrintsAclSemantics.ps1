[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$fixtureRoot = Join-Path ([IO.Path]::GetTempPath()) ('DleOsDrawingAclProbe-' + [Guid]::NewGuid().ToString('N'))
$resolvedFixture = [IO.Path]::GetFullPath($fixtureRoot)
$resolved = Join-Path $resolvedFixture 'Drawing-Prints'
$tempResolved = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
if (-not $resolvedFixture.StartsWith($tempResolved, [StringComparison]::OrdinalIgnoreCase)) {
    throw 'ACL semantics probe escaped the temporary root.'
}

try {
    [void][IO.Directory]::CreateDirectory($resolvedFixture)
    [void][IO.Directory]::CreateDirectory($resolved)
    $unrelated = [IO.Directory]::CreateDirectory((Join-Path $resolvedFixture 'Unrelated-Production')).FullName
    $child = [IO.Directory]::CreateDirectory((Join-Path $resolved 'child')).FullName
    $file = Join-Path $resolved 'probe.txt'
    [IO.File]::WriteAllText($file, 'probe')
    $sid = New-Object Security.Principal.SecurityIdentifier('S-1-5-21-1111111111-2222222222-3333333333-4242')
    $acl = [IO.Directory]::GetAccessControl($resolved)
    $preservedSections = [Security.AccessControl.AccessControlSections]::Access -bor [Security.AccessControl.AccessControlSections]::Owner -bor [Security.AccessControl.AccessControlSections]::Group
    $preSddl = [IO.Directory]::GetAccessControl($resolved, $preservedSections).GetSecurityDescriptorSddlForm($preservedSections)
    $unrelatedSddl = [IO.Directory]::GetAccessControl($unrelated, $preservedSections).GetSecurityDescriptorSddlForm($preservedSections)
    $rule = New-Object Security.AccessControl.FileSystemAccessRule(
        $sid,
        [Security.AccessControl.FileSystemRights]::ReadAndExecute,
        [Security.AccessControl.InheritanceFlags]::ContainerInherit,
        [Security.AccessControl.PropagationFlags]::None,
        [Security.AccessControl.AccessControlType]::Allow)
    $acl.AddAccessRule($rule)
    [IO.Directory]::SetAccessControl($resolved, $acl)

    $rootRules = @([IO.Directory]::GetAccessControl($resolved).GetAccessRules($true, $false, [Security.Principal.SecurityIdentifier]) | Where-Object { $sid.Equals($_.IdentityReference) })
    $childRules = @([IO.Directory]::GetAccessControl($child).GetAccessRules($false, $true, [Security.Principal.SecurityIdentifier]) | Where-Object { $sid.Equals($_.IdentityReference) })
    $fileRules = @([IO.File]::GetAccessControl($file).GetAccessRules($false, $true, [Security.Principal.SecurityIdentifier]) | Where-Object { $sid.Equals($_.IdentityReference) })
    if ($rootRules.Count -ne 1 -or $rootRules[0].InheritanceFlags -ne [Security.AccessControl.InheritanceFlags]::ContainerInherit) {
        throw 'The representative root ACE was not ContainerInherit-only.'
    }
    if ($childRules.Count -ne 1) {
        throw 'The representative child directory did not inherit the enumeration ACE.'
    }
    if ($fileRules.Count -ne 0) {
        throw 'The representative file unexpectedly inherited the enumeration ACE.'
    }
    $unrelatedAfter = [IO.Directory]::GetAccessControl($unrelated, $preservedSections).GetSecurityDescriptorSddlForm($preservedSections)
    if ($unrelatedAfter -ne $unrelatedSddl) {
        throw 'The representative unrelated Production ACL changed.'
    }
    $rollbackAcl = [IO.Directory]::GetAccessControl($resolved, $preservedSections)
    $rollbackAcl.SetSecurityDescriptorSddlForm($preSddl, $preservedSections)
    [IO.Directory]::SetAccessControl($resolved, $rollbackAcl)
    $restoredSddl = [IO.Directory]::GetAccessControl($resolved, $preservedSections).GetSecurityDescriptorSddlForm($preservedSections)
    if ($restoredSddl -ne $preSddl) {
        throw 'The representative rollback did not restore the exact pre-change SDDL.'
    }
    Write-Output 'Drawing-Prints container-only ACL and exact-SDDL rollback semantics: PASS'
}
finally {
    if ([IO.Directory]::Exists($resolvedFixture)) {
        Remove-Item -LiteralPath $resolvedFixture -Recurse -Force
    }
}
