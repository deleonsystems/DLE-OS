param([ValidateSet('Prepare','Confirm','Verify')][string]$Stage='Verify')
$ErrorActionPreference='Stop'
$repo=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$folder=Join-Path $repo 'output/E2E-SIM-001-source-pn'
$dataPath=Join-Path $repo '.sim-state/data/rfq-intakes.json'
$profile=Get-Content (Join-Path $env:LOCALAPPDATA 'DLE-OS/SIM/sim-profile.json') -Raw|ConvertFrom-Json
if([IO.Path]::GetFullPath($profile.repoPath) -ne $repo){throw 'Wrong SIM repository.'}
function Canonical($v){ConvertTo-Json -InputObject $v -Depth 100 -Compress}
function Fingerprint {
    $hashes=@{}
    foreach($directory in @('data','state','intake-documents','documents')){
        $path=Join-Path $repo ".sim-state/$directory"
        if(Test-Path $path){Get-ChildItem -LiteralPath $path -Recurse -File|ForEach-Object{$hashes[[IO.Path]::GetRelativePath($repo,$_.FullName)]=(Get-FileHash -LiteralPath $_.FullName).Hash}}
    }
    return $hashes
}
if($Stage -eq 'Prepare'){
    if(Test-Path (Join-Path $folder 'intakes-before.json')){throw 'Baseline already exists; refusing overwrite.'}
    $null=New-Item -ItemType Directory -Force -Path $folder
    $data=Get-Content $dataPath -Raw|ConvertFrom-Json
    $record=$data.records|Where-Object intakeId -eq RFQI-SIM-0042
    $bom=$record.technicalReview.candidateBom
    $row=$bom.rows|Where-Object {$_.values.partNumber -eq 'SIM-R-1K'}
    $pcb=$bom.rows|Where-Object {$_.values.partNumber -eq 'SIM-PCB-001'}
    if($bom.id -ne 'bf7cf8ee-c819-4ced-9e94-8d25dbab8c2f' -or $bom.rows.Count -ne 12 -or @($bom.rows|Where-Object confirmed).Count -ne 1 -or !$pcb.confirmed -or $pcb.assemblyIdentity.partNumber -ne 'SIM-PCB-001 REV A' -or $row.confirmed -or $row.sourcePartNumberReview){throw 'Unexpected live checkpoint.'}
    Copy-Item -LiteralPath $dataPath -Destination (Join-Path $folder 'intakes-before.json')
    Fingerprint|ConvertTo-Json -Depth 5|Set-Content (Join-Path $folder 'hashes-before.json')
    Write-Output 'PASS: live checkpoint and business file baseline captured; no business writes.'
    exit
}
$session=[Microsoft.PowerShell.Commands.WebRequestSession]::new()
$code=[Environment]::GetEnvironmentVariable('DLE_OS_SIM_PERMANENT_ACCESS_CODE','User')
if(!$code){throw 'SIM access unavailable.'}
$null=Invoke-WebRequest ($profile.url+'/sim-access') -Method Post -Body @{sim_access=$code} -WebSession $session -TimeoutSec 10
$before=Get-Content (Join-Path $folder 'intakes-before.json') -Raw|ConvertFrom-Json
$old=$before.records|Where-Object intakeId -eq RFQI-SIM-0042
$endpoint=$profile.url+'/api/sim/technical-reviews/RFQI-SIM-0042'
if($Stage -eq 'Confirm'){
    if((Get-FileHash $dataPath).Hash -ne (Get-FileHash (Join-Path $folder 'intakes-before.json')).Hash){throw 'Live data changed since baseline; stop before confirmation.'}
    $review=Invoke-RestMethod $endpoint -WebSession $session
    $review|ConvertTo-Json -Depth 100|Set-Content (Join-Path $folder 'review-before.json')
    $bom=$review.record.technicalReview.candidateBom
    $row=$bom.rows|Where-Object {$_.values.partNumber -eq 'SIM-R-1K'}
    if($row.confirmed -or $row.sourcePartNumberReview -or $row.componentType -ne 'STANDARD_COTS'){throw 'Target changed.'}
    $body=@{candidateId=$bom.id;rowIndex=$row.index;values=$null;sourcePartNumberChange=@{basis='MFG';expectedToken=$row.reviewState.token}}
    $body|ConvertTo-Json -Depth 10|Set-Content (Join-Path $folder 'confirmation-request.json')
    $response=Invoke-RestMethod ($endpoint+'/candidate-bom') -Method Put -ContentType 'application/json' -Body (Canonical $body) -WebSession $session
    $response|ConvertTo-Json -Depth 100|Set-Content (Join-Path $folder 'confirmation-response.json')
}
$after=Get-Content $dataPath -Raw|ConvertFrom-Json
$new=$after.records|Where-Object intakeId -eq RFQI-SIM-0042
$target=$new.technicalReview.candidateBom.rows|Where-Object {$_.values.partNumber -eq 'SIM-R-1K'}
$oldTarget=$old.technicalReview.candidateBom.rows|Where-Object {$_.values.partNumber -eq 'SIM-R-1K'}
$decision=$target.sourcePartNumberReview.current
if($target.confirmed -or $target.componentType -ne $oldTarget.componentType -or (Canonical $target.values) -cne (Canonical $oldTarget.values) -or $decision.basis -ne 'MFG' -or $decision.status -ne 'CONFIRMED' -or $decision.origin -ne 'DOCUMENT_DEFAULT_CONFIRMED' -or $target.sourcePartNumberReview.history.Count -ne 1){throw 'Wrong target identity outcome.'}
$approved=@($target.manufacturerIdentity.proposals|Where-Object {('manufacturer:'+$_.id) -eq $decision.identityReference})
if($approved.Count -ne 1 -or $approved[0].partNumber -ne 'SIM-R-1K' -or $approved[0].manufacturerName){throw 'Wrong resulting manufacturer identity.'}
if(($target.manufacturerIdentity.history|Where-Object proposalId -eq $approved[0].id|Select-Object -Last 1).decision -ne 'CONFIRMED'){throw 'Identity not confirmed.'}
$restored=(Canonical $new)|ConvertFrom-Json
$restored.technicalReview.candidateBom.rows[$target.index]=$oldTarget
if((Canonical $restored) -cne (Canonical $old)){throw 'Intake, another row or Technical Review state changed.'}
if((Canonical @($before.records|Where-Object intakeId -ne RFQI-SIM-0042)) -cne (Canonical @($after.records|Where-Object intakeId -ne RFQI-SIM-0042))){throw 'Unrelated intake changed.'}
if((Canonical $before.analysisJobs) -cne (Canonical $after.analysisJobs)){throw 'Analysis jobs changed.'}
$hashes=Get-Content (Join-Path $folder 'hashes-before.json') -Raw|ConvertFrom-Json -AsHashtable
$current=Fingerprint
foreach($key in $hashes.Keys){if($key -ne '.sim-state\data\rfq-intakes.json' -and $hashes[$key] -ne $current[$key]){throw "Business file changed: $key"}}
if($current.Count -ne $hashes.Count){throw 'Unexpected new business files.'}
$review=Invoke-RestMethod $endpoint -WebSession $session
$review|ConvertTo-Json -Depth 100|Set-Content (Join-Path $folder 'review-after.json')
$live=$review.record.technicalReview.candidateBom.rows[$target.index]
if($live.reviewState.reviewed -or $live.confirmed){throw 'Identity-only action accepted the row.'}
@{result='PASS';intake='RFQI-SIM-0042';candidateId=$new.technicalReview.candidateBom.id;rowIndex=$target.index;sourcePn=$target.values.partNumber;basis=$decision.basis;basisStatus=$decision.status;approvedPn=$approved[0].partNumber;type=$target.componentType;rowAccepted=$target.confirmed;rowReviewed=$live.reviewState.reviewed;confirmedRows=@($new.technicalReview.candidateBom.rows|Where-Object confirmed).Count;sourceDecision=$decision;otherElevenRowsUnchanged=$true;otherTechnicalReviewAndIntakeFieldsUnchanged=$true;otherIntakesUnchanged=@($after.records|Where-Object intakeId -ne RFQI-SIM-0042).Count;otherBusinessFilesUnchanged=$hashes.Count-1;validatedAtUtc=[DateTimeOffset]::UtcNow.ToString('O')}|ConvertTo-Json -Depth 10|Set-Content (Join-Path $folder 'verification.json')
Get-Content (Join-Path $folder 'verification.json')
