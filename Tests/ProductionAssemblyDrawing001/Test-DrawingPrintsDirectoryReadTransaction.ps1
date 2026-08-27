[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$repository = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$transactionPath = Join-Path $repository 'Tools\DevelopmentRuntime\Invoke-DleOsDrawingPrintsDirectoryReadTransaction.ps1'
$packagePath = Join-Path $repository 'Tools\DevelopmentRuntime\New-DleOsDrawingPrintsDirectoryReadPackage.ps1'
$transaction = [IO.File]::ReadAllText($transactionPath)
$package = [IO.File]::ReadAllText($packagePath)

function Assert-True([bool]$Value, [string]$Message) {
    if (-not $Value) { throw $Message }
}

$tokens = $null
$errors = $null
[void][Management.Automation.Language.Parser]::ParseFile($transactionPath, [ref]$tokens, [ref]$errors)
Assert-True ($errors.Count -eq 0) 'Transaction script must parse under Windows PowerShell.'
$tokens = $null
$errors = $null
[void][Management.Automation.Language.Parser]::ParseFile($packagePath, [ref]$tokens, [ref]$errors)
Assert-True ($errors.Count -eq 0) 'Package script must parse under Windows PowerShell.'

Assert-True ($transaction.Contains("`$ExpectedComputer = 'DELEON-SERVER'")) 'Transaction must be fixed to DELEON-SERVER.'
Assert-True ($transaction.Contains("`$ExpectedShare = 'Production'")) 'Transaction must be fixed to the Production share.'
Assert-True ($transaction.Contains("`$ExpectedRelativePath = 'Drawing-Prints'")) 'Transaction must be fixed to Drawing-Prints.'
Assert-True ($transaction.Contains("`$ExpectedQualifiedAccount = 'DELEON-SERVER\DLE-OS-DEV-FRONTEND'")) 'Transaction must use the existing matched account.'
Assert-True ($transaction.Contains("`$ExpectedAccountSid = 'S-1-5-21-2944932128-830765809-3256817259-1042'")) 'Transaction must pin the audited account SID.'
Assert-True ($transaction.Contains('[Security.AccessControl.InheritanceFlags]::ContainerInherit')) 'Directory inheritance must be present.'
Assert-True (-not $transaction.Contains('$inheritance = [Security.AccessControl.InheritanceFlags]::ContainerInherit -bor [Security.AccessControl.InheritanceFlags]::ObjectInherit' + "`r`n" + '    $propagation = [Security.AccessControl.PropagationFlags]::None' + "`r`n" + '    $allow = [Security.AccessControl.AccessControlType]::Allow' + "`r`n" + '    $rule')) 'The Drawing-Prints grant must not use ObjectInherit.'
Assert-True ($transaction.Contains("FileContentReadGranted='False'")) 'Evidence must state that file read was not granted.'
Assert-True ($transaction.Contains("MutationRightsGranted='False'")) 'Evidence must state that mutation rights were not granted.'
Assert-True ($transaction.Contains("ShareAclChanged='False'")) 'Evidence must state that the share ACL was unchanged.'
Assert-True ($transaction.Contains('Restore-Sddl $targetPath $preSddl')) 'Automatic rollback must restore the exact pre-change SDDL.'
Assert-True ($transaction.Contains('rollback-state.dpapi')) 'Rollback state must be DPAPI protected.'
Assert-True ($transaction.Contains('Get-StructureInventory')) 'Transaction must compare Drawing-Prints structure metadata.'
Assert-True ($transaction.Contains('Assert-AllDirectoriesEnumerable')) 'Transaction must prove that container-only inheritance reaches every Drawing-Prints directory.'
Assert-True ($transaction.Contains('ReparsePoint')) 'Transaction must reject reparse-point traversal.'
Assert-True ($transaction.Contains('Get-UnrelatedAclDigest')) 'Transaction must compare unrelated Production ACLs.'
Assert-True (-not ($transaction -match 'New-Item\s+.*Drawing-Prints|Remove-Item|Rename-Item|Move-Item|Set-Content\s+.*Drawing-Prints')) 'Transaction must not mutate Drawing-Prints content.'
Assert-True (-not $transaction.Contains('.Dispose()')) 'The server transaction must not call IDisposable.Dispose through PowerShell 2 dynamic dispatch.'
Assert-True ($transaction.Contains('$sha.Clear()')) 'The SHA-256 implementation must use the CLR 2-compatible Clear cleanup path.'
Assert-True ($transaction.Contains('$stream.Close()')) 'The file-hash stream must use the CLR 2-compatible Close cleanup path.'
Assert-True (-not $transaction.Contains('[Security.AccessControl.AccessControlSections]::All')) 'The server transaction must not require SeSecurityPrivilege merely to read an untouched audit SACL.'
Assert-True ($transaction.Contains('$PreservedSections')) 'The transaction must preserve owner, group, and DACL explicitly.'
Assert-True (-not ($transaction -match '\(Get-SidRules[^\r\n]+\)\.Count')) 'Command-returned SID rules must never be dereferenced through a PS2-unsafe scalar Count assumption.'
Assert-True ($transaction.Contains('$productionRootRules = @(Get-SidRules')) 'Production-root SID rules must be captured through an explicit array boundary.'
Assert-True ($transaction.Contains('$preflightTargetRules = @(Get-SidRules')) 'Preflight target SID rules must be captured through an explicit array boundary.'
Assert-True ($transaction.Contains('$applyTargetRules = @(Get-SidRules')) 'Apply target SID rules must be captured through an explicit array boundary.'
Assert-True ($transaction.Contains("LoadWithPartialName('System.Security')")) 'PowerShell 2 must explicitly load the DPAPI assembly.'
Assert-True ($transaction.Contains("LoadWithPartialName('System.DirectoryServices')")) 'PowerShell 2 must explicitly load the local-account assembly.'
Assert-True ($package.Contains('Apply-On-DELEON-SERVER.cmd')) 'Package must include an explicit local apply launcher.'
Assert-True ($package.Contains('Rollback-On-DELEON-SERVER.cmd')) 'Package must include an explicit local rollback launcher.'

Write-Output 'Drawing-Prints directory-read transaction contract: PASS'
