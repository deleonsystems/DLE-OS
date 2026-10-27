Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
# Pure review planner: consumes explicit evidence; never queries or mutates a machine.
function Assert-PlanEvidence($Desired,$Observed) {
 if($Desired.serviceName -cne 'DleOsDevelopmentQuoting' -or $Desired.identity -cne 'NT SERVICE\DleOsDevelopmentQuoting' -or $Desired.startup -cne 'Manual'){throw 'Unexpected service identity/startup'}
 if($Desired.listenUrl -cne 'http://127.0.0.1:5060/' -or $Desired.releaseRoot -cne 'C:\ProgramData\DLE-OS\DevelopmentQuotingService\releases' -or $Desired.configPath -cne 'C:\ProgramData\DLE-OS\DevelopmentQuotingService\config\backend.json' -or $Desired.dataRoot -cne 'C:\ProgramData\DLE-OS\DevelopmentQuoting'){throw 'Unexpected service path/port'}
 if($Desired.activationApproved -ne $false){throw 'Preparation must leave activation disabled'}
 if($Observed.hostName -cne 'DLE-OS-HOST' -or $Observed.complete -ne $true){throw 'Complete authorized host evidence required'}
 $age=[DateTimeOffset]::UtcNow-[DateTimeOffset]::Parse($Observed.capturedUtc)
 if($age.TotalMinutes -gt 15 -or $age.TotalSeconds -lt -30){throw 'Evidence stale or future dated'}
 if($Observed.hasReparsePoint -ne $false){throw 'Unresolved or linked target paths'}
 if($Observed.releaseManifestSha256 -notmatch '^[A-Fa-f0-9]{64}$'){throw 'Exact candidate artifact digest required'}
 if($Observed.targetRelease -notmatch '^C:\\ProgramData\\DLE-OS\\DevelopmentQuotingService\\releases\\[A-Za-z0-9_-]+$'){throw 'Release escapes dedicated root'}
 if($Observed.unknownPartialState -ne $false){throw 'Interrupted/unknown state requires inspection; no automatic retry'}
}
function Get-QuotingInstallPlan($Desired,$Observed) {
 Assert-PlanEvidence $Desired $Observed
 if($Observed.portInUse -ne $false){throw 'Port occupied or unknown; do not alter it'}
 if($Observed.targetExists -and !$Observed.targetMatches){throw 'Existing release content conflict'}
 if($null -ne $Observed.service){
  $s=$Observed.service
  if($s.identity -cne $Desired.identity -or $s.startup -cne 'Manual' -or $s.state -cne 'Stopped' -or $s.release -cne $Observed.targetRelease -or $s.manifestSha256 -cne $Observed.releaseManifestSha256 -or $s.configPath -cne $Desired.configPath){throw 'Existing service conflict: never overwrite'}
  if($Observed.urlReservationPresent -ne $true -or $Observed.urlReservationOwner -cne $Desired.identity){throw 'Existing registration has missing or conflicting URL reservation; inspect before repair'}
  return [pscustomobject]@{ReviewOnly=$true;Disposition='NoOp';Actions=@();PreserveData=$true}
 }
 if($Observed.urlReservationPresent -ne $false){throw 'URL reservation occupied or unknown; do not alter it'}
 if($Observed.bindingsQualified -ne $true){throw 'Unqualified frontend authorization, reference, renderer or public-key bindings'}
 [pscustomobject]@{ReviewOnly=$true;Disposition='ProposedInstall';PreserveData=$true;Actions=@(
  'Capture original state and exact artifact/config digests in administrator-owned receipt; revalidate before each later mutation',
  'Stage verified immutable release; stop on existing nonmatching path; no overwrite or recursive delete',
  'Grant SYSTEM and Administrators full control on dedicated service/config roots; service read/execute only; remove inherited broad write access only on newly created dedicated roots',
  'Grant service Modify only on dedicated data/state and data/source; service read/traverse on data root; no write access to code, config, public key or Library reference',
  'Register only DleOsDevelopmentQuoting, Manual, virtual identity NT SERVICE\DleOsDevelopmentQuoting, exact quoted QuotingRuntime.exe --config backend.json --windows-service; do not start',
  'Reserve only http://127.0.0.1:5060/ for that service identity; no firewall rule or wildcard prefix',
  'Record receipt after every completed step; an uncertain step requires observation, not replay',
  'Keep activationApproved=false; do not start frontend/backend or create business records')}
}
function Get-QuotingRollbackPlan($Desired,$Observed,$Receipt) {
 Assert-PlanEvidence $Desired $Observed
 if($Receipt.createdByThisOperation -ne $true -or $Receipt.serviceName -cne $Desired.serviceName -or $Receipt.release -cne $Observed.targetRelease -or $Receipt.manifestSha256 -cne $Observed.releaseManifestSha256){throw 'Owned matching installation receipt required'}
 if($null -eq $Observed.service){return [pscustomobject]@{ReviewOnly=$true;Disposition='NoOp';Actions=@();PreserveData=$true}}
 $s=$Observed.service
 if($s.state -cne 'Stopped' -or $s.identity -cne $Desired.identity -or $s.release -cne $Receipt.release -or $s.manifestSha256 -cne $Receipt.manifestSha256 -or $s.configPath -cne $Desired.configPath){throw 'Rollback requires exact stopped owned service'}
 [pscustomobject]@{ReviewOnly=$true;Disposition='ProposedRollback';PreserveData=$true;Actions=@(
  'Revalidate receipt and service identity/binary/config before removal; no stop or kill is implicit',
  'Remove only the stopped service registration created by this receipt',
  'Remove only its exact URL reservation if receipt proves this operation created it and current owner still matches',
  'Retain all data, releases, configuration, logs and ACL evidence for recovery; no file deletion, account deletion or role rollback',
  'If business data has been written, require separately reviewed format-compatible recovery; binary rollback alone is insufficient')}
}
Export-ModuleMember -Function Get-QuotingInstallPlan,Get-QuotingRollbackPlan
