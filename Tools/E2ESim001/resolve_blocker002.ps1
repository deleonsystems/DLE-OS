param([switch] $VerifyOnly)
$ErrorActionPreference='Stop'
$repo=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$folder=Join-Path $repo 'output/E2E-SIM-001-blocker-002'
$dataPath=Join-Path $repo '.sim-state/data/rfq-intakes.json'
$source=Join-Path $repo 'output/pdf/E2E-SIM-001/01_SIM-E2E-001_RFQ_A.pdf'
$profile=Get-Content (Join-Path $env:LOCALAPPDATA 'DLE-OS/SIM/sim-profile.json') -Raw|ConvertFrom-Json
if([IO.Path]::GetFullPath($profile.repoPath) -ne $repo){throw 'Wrong SIM repository.'}
function Session {
    $s=[Microsoft.PowerShell.Commands.WebRequestSession]::new()
    $code=[Environment]::GetEnvironmentVariable('DLE_OS_SIM_PERMANENT_ACCESS_CODE','User')
    if(!$code){throw 'SIM access unavailable.'}
    $null=Invoke-WebRequest ($profile.url+'/sim-access') -Method Post -Body @{sim_access=$code} -WebSession $s -TimeoutSec 10
    return $s
}
function Canonical($v){ConvertTo-Json -InputObject $v -Depth 100 -Compress}
function Fingerprint {
    $h=@{}
    foreach($directory in @('data','state','intake-documents','documents')){
        $p=Join-Path $repo ".sim-state/$directory"
        if(Test-Path $p){Get-ChildItem -LiteralPath $p -Recurse -File|ForEach-Object{$h[[IO.Path]::GetRelativePath($repo,$_.FullName)]=(Get-FileHash -LiteralPath $_.FullName).Hash}}
    }
    return $h
}
if(!$VerifyOnly){
    $session=Session
    $status=Invoke-RestMethod ($profile.url+'/api/sim/status') -WebSession $session
    if($status.status -ne 'READY' -or $status.environment -ne 'SIM'){throw 'SIM not ready.'}
    $before=Get-Content $dataPath -Raw|ConvertFrom-Json
    $r=$before.records|Where-Object intakeId -eq RFQI-SIM-0042
    if($r.customer.customerId -ne 'SIM-CUSTOMER-E2E-001' -or $r.technicalReview.candidateBom.id -ne 'bf7cf8ee-c819-4ced-9e94-8d25dbab8c2f' -or $r.technicalReview.candidateBom.rows.Count -ne 12 -or @($r.technicalReview.candidateBom.rows|Where-Object confirmed).Count -ne 0 -or $r.customerRequestDocuments){throw 'Unexpected target checkpoint.'}
    Copy-Item -LiteralPath $dataPath -Destination (Join-Path $folder 'intakes-before.json')
    Fingerprint|ConvertTo-Json -Depth 5|Set-Content (Join-Path $folder 'hashes-before.json')
    & (Join-Path $repo 'Tools/SimRuntime/Stop-DleOsSim.ps1') -Json
    & (Join-Path $repo 'Tools/SimRuntime/DesktopControls/Start-DleOsSimServer.ps1')
    if($LASTEXITCODE -ne 0){throw 'Restart failed.'}
    if((Get-FileHash $dataPath).Hash -ne (Get-FileHash (Join-Path $folder 'intakes-before.json')).Hash){throw 'Restart changed intake data.'}
    $session=Session
    $url=$profile.url+'/api/sim/rfq-intakes/RFQI-SIM-0042/customer-request-documents?name=01_SIM-E2E-001_RFQ_A.pdf'
    $result=Invoke-RestMethod $url -Method Post -Headers @{'X-SIM-Document-Upload'='1'} -ContentType 'application/octet-stream' -InFile $source -WebSession $session
    $result|ConvertTo-Json -Depth 100|Set-Content (Join-Path $folder 'attachment-response.json')
    $hashBeforeRetry=(Get-FileHash $dataPath).Hash
    $retry=Invoke-RestMethod $url -Method Post -Headers @{'X-SIM-Document-Upload'='1'} -ContentType 'application/octet-stream' -InFile $source -WebSession $session
    if(!$retry.duplicate -or $retry.attachment.document.documentId -ne $result.attachment.document.documentId -or (Get-FileHash $dataPath).Hash -ne $hashBeforeRetry){throw 'Duplicate protection failed.'}
}
$session=Session
$before=Get-Content (Join-Path $folder 'intakes-before.json') -Raw|ConvertFrom-Json
$after=Get-Content $dataPath -Raw|ConvertFrom-Json
$old=$before.records|Where-Object intakeId -eq RFQI-SIM-0042
$new=$after.records|Where-Object intakeId -eq RFQI-SIM-0042
$attachment=@($new.customerRequestDocuments)
if($attachment.Count -ne 1){throw 'Wrong request attachment count.'}
$a=$attachment[0];$id=$a.document.documentId
if($a.owner -ne 'Intake' -or $a.type -ne 'CUSTOMER_RFQ_REQUEST' -or $a.sha256 -ne (Get-FileHash $source).Hash){throw 'Attachment identity/hash mismatch.'}
$viewUrl=$profile.url+'/api/sim/rfq-intakes/RFQI-SIM-0042/customer-request-documents/'+$id
$retrieved=Join-Path $folder 'retrieved-request.pdf'
$download=Invoke-WebRequest $viewUrl -WebSession $session -OutFile $retrieved -PassThru
if($download.StatusCode -ne 200 -or (Get-FileHash $retrieved).Hash -ne $a.sha256){throw 'Retrieval verification failed.'}
$newWithoutRequest=($new|ConvertTo-Json -Depth 100)|ConvertFrom-Json
$newWithoutRequest.PSObject.Properties.Remove('customerRequestDocuments')
if((Canonical $old) -cne (Canonical $newWithoutRequest)){throw 'Existing target intake/review state changed.'}
if((Canonical @($before.records|Where-Object intakeId -ne RFQI-SIM-0042)) -cne (Canonical @($after.records|Where-Object intakeId -ne RFQI-SIM-0042))){throw 'Unrelated intake changed.'}
if((Canonical $before.analysisJobs) -cne (Canonical $after.analysisJobs)){throw 'Analysis jobs changed.'}
if($new.technicalFiles.documentId -contains $id -or $new.technicalReview.technicalPackage.documents.documentId -contains $id -or $new.technicalReview.candidateBom.analysis.sourceSnapshot.sources.documentId -contains $id){throw 'Commercial document entered technical sources.'}
$hashes=Get-Content (Join-Path $folder 'hashes-before.json') -Raw|ConvertFrom-Json -AsHashtable
$current=Fingerprint
foreach($key in $hashes.Keys){if($key -ne '.sim-state\data\rfq-intakes.json' -and $hashes[$key] -ne $current[$key]){throw "Prior business file changed: $key"}}
if($current.Count -ne $hashes.Count+2){throw 'Unexpected new business files.'}
$review=Invoke-RestMethod ($profile.url+'/api/sim/technical-reviews/RFQI-SIM-0042') -WebSession $session
$review|ConvertTo-Json -Depth 100|Set-Content (Join-Path $folder 'review-after.json')
@{result='PASS';intake='RFQI-SIM-0042';documentId=$id;filename=$a.document.name;sha256=$a.sha256;owner=$a.owner;type=$a.type;addedBy=$a.addedBy;retrievalStatus=$download.StatusCode;retrievalContentType=[string]$download.Headers['Content-Type'];retrievalUrl=$viewUrl;candidateId=$new.technicalReview.candidateBom.id;rows=$new.technicalReview.candidateBom.rows.Count;confirmedRows=@($new.technicalReview.candidateBom.rows|Where-Object confirmed).Count;originalTargetFieldsUnchanged=$true;otherIntakesUnchanged=@($before.records|Where-Object intakeId -ne RFQI-SIM-0042).Count;existingOtherBusinessFilesUnchanged=$hashes.Count-1;newBinaryAndManifestFiles=2;validatedAtUtc=[DateTimeOffset]::UtcNow.ToString('O')}|ConvertTo-Json|Set-Content (Join-Path $folder 'verification.json')
Get-Content (Join-Path $folder 'verification.json')
