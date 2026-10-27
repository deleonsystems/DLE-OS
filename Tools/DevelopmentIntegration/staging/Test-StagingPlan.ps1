param([Parameter(Mandatory)][string]$ResultPath)
$ErrorActionPreference='Stop'
Import-Module (Join-Path $PSScriptRoot 'StagingPlan.psm1') -Force
$desired=Get-Content (Join-Path $PSScriptRoot 'service-proposal.json') -Raw|ConvertFrom-Json
$checks=[Collections.Generic.List[string]]::new()
function Check($ok,$name){if(!$ok){throw $name};$checks.Add($name)}
function Refuse([scriptblock]$action,$name){$denied=$false;try{& $action|Out-Null}catch{$denied=$true};Check $denied $name}
function Sample { [pscustomobject]@{hostName='DLE-OS-HOST';complete=$true;capturedUtc=[DateTimeOffset]::UtcNow.ToString('O');hasReparsePoint=$false;releaseManifestSha256=('A'*64);targetRelease='C:\ProgramData\DLE-OS\DevelopmentQuotingService\releases\synthetic-only';unknownPartialState=$false;portInUse=$false;urlReservationPresent=$false;targetExists=$false;targetMatches=$false;bindingsQualified=$true;service=$null} }
function Existing($o){[pscustomobject]@{identity=$desired.identity;startup='Manual';state='Stopped';release=$o.targetRelease;manifestSha256=$o.releaseManifestSha256;configPath=$desired.configPath}}
$o=Sample;$p=Get-QuotingInstallPlan $desired $o;Check ($p.ReviewOnly -and $p.Disposition -eq 'ProposedInstall') 'complete synthetic evidence produces review-only install plan'
Check ($p.Actions -join ' ' -match 'do not start') 'install plan does not activate service'
foreach($field in @('portInUse','urlReservationPresent','hasReparsePoint','unknownPartialState')){$o=Sample;$o.$field=$true;Refuse {Get-QuotingInstallPlan $desired $o} "$field denied"}
$o=Sample;$o.complete=$false;Refuse {Get-QuotingInstallPlan $desired $o} 'incomplete inventory denied'
$o=Sample;$o.bindingsQualified=$false;Refuse {Get-QuotingInstallPlan $desired $o} 'missing external bindings denied'
$o=Sample;$o.capturedUtc=[DateTimeOffset]::UtcNow.AddMinutes(-20).ToString('O');Refuse {Get-QuotingInstallPlan $desired $o} 'stale evidence denied'
$o=Sample;$o.targetRelease='C:\Windows\synthetic';Refuse {Get-QuotingInstallPlan $desired $o} 'path escape denied'
$o=Sample;$o.targetExists=$true;Refuse {Get-QuotingInstallPlan $desired $o} 'conflicting release denied'
$o=Sample;$o.targetExists=$true;$o.targetMatches=$true;Check ((Get-QuotingInstallPlan $desired $o).Disposition -eq 'ProposedInstall') 'verified staged release can resume before registration'
$o=Sample;$o.service=Existing $o;$o.urlReservationPresent=$true;$o|Add-Member urlReservationOwner $desired.identity;Check ((Get-QuotingInstallPlan $desired $o).Disposition -eq 'NoOp') 'repeated matching stopped registration is no-op'
$o.urlReservationOwner='OTHER';Refuse {Get-QuotingInstallPlan $desired $o} 'existing reservation wrong owner denied'
foreach($field in @('identity','startup','state','release','manifestSha256','configPath')){$o=Sample;$o.service=Existing $o;$o.service.$field='unexpected';Refuse {Get-QuotingInstallPlan $desired $o} "service $field conflict denied"}
$o=Sample;$o.service=Existing $o;$receipt=[pscustomobject]@{createdByThisOperation=$true;serviceName=$desired.serviceName;release=$o.targetRelease;manifestSha256=$o.releaseManifestSha256}
$rollback=Get-QuotingRollbackPlan $desired $o $receipt;Check ($rollback.PreserveData -and $rollback.Disposition -eq 'ProposedRollback') 'owned stopped rollback preserves all records'
$o.service.state='Running';Refuse {Get-QuotingRollbackPlan $desired $o $receipt} 'rollback does not implicitly stop running service'
$o.service=$null;Check ((Get-QuotingRollbackPlan $desired $o $receipt).Disposition -eq 'NoOp') 'repeated rollback absent service no-op'
$receipt.createdByThisOperation=$false;Refuse {Get-QuotingRollbackPlan $desired $o $receipt} 'unowned rollback denied'
foreach($file in Get-ChildItem $PSScriptRoot -File | Where-Object Extension -In '.ps1','.psm1'){
 $tokens=$null;$errors=$null;$ast=[Management.Automation.Language.Parser]::ParseFile($file.FullName,[ref]$tokens,[ref]$errors)
 Check ($errors.Count -eq 0) ("PowerShell parse: "+$file.Name)
 $commands=$ast.FindAll({param($n) $n -is [Management.Automation.Language.CommandAst]},$true)|ForEach-Object GetCommandName
 Check (@($commands|Where-Object {$_ -match '^(New-Service|Start-Service|Stop-Service|Set-Service|Remove-Service|Set-Acl|Remove-Item|Invoke-Sqlcmd|sqlcmd|sc|netsh)(\.exe)?$'}).Count -eq 0) ("no mutation commands: "+$file.Name)
}
[pscustomobject]@{Passed=$true;Count=$checks.Count;Checks=$checks;SyntheticEvidenceOnly=$true;LiveProvisioningTested=$false}|ConvertTo-Json -Depth 5|Set-Content -LiteralPath $ResultPath
Write-Output "PASS $($checks.Count) staging planner checks"
