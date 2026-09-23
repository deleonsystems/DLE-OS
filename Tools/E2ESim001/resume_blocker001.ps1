param([switch] $VerifyOnly)
$ErrorActionPreference = 'Stop'
$repo = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$folder = Join-Path $repo 'output/E2E-SIM-001-blocker-001'
$dataPath = Join-Path $repo '.sim-state/data/rfq-intakes.json'
$profile = Get-Content (Join-Path $env:LOCALAPPDATA 'DLE-OS/SIM/sim-profile.json') -Raw | ConvertFrom-Json
if ([IO.Path]::GetFullPath($profile.repoPath) -ne $repo) { throw 'Wrong SIM repository.' }
function Session {
    $s = [Microsoft.PowerShell.Commands.WebRequestSession]::new()
    $code = [Environment]::GetEnvironmentVariable('DLE_OS_SIM_PERMANENT_ACCESS_CODE','User')
    if (!$code) { throw 'Configured SIM access unavailable.' }
    $null = Invoke-WebRequest ($profile.url + '/sim-access') -Method Post -Body @{sim_access=$code} -WebSession $s -TimeoutSec 10
    return $s
}
function Canonical($value) { ConvertTo-Json -InputObject $value -Depth 100 -Compress }
function Fingerprint {
    $hashes=@{}
    foreach ($directory in @('data','state','intake-documents','documents')) {
        $path=Join-Path $repo ".sim-state/$directory"
        if (Test-Path $path) { Get-ChildItem -LiteralPath $path -Recurse -File | ForEach-Object {
            $hashes[[IO.Path]::GetRelativePath($repo,$_.FullName)]=(Get-FileHash -LiteralPath $_.FullName).Hash
        } }
    }
    return $hashes
}
if (!$VerifyOnly) {
    $session=Session
    $status=Invoke-RestMethod ($profile.url+'/api/sim/status') -WebSession $session
    if ($status.status -ne 'READY' -or $status.environment -ne 'SIM') { throw 'SIM not ready.' }
    $before=Get-Content $dataPath -Raw | ConvertFrom-Json
    $target=$before.records | Where-Object intakeId -eq 'RFQI-SIM-0042'
    if ($target.environment -ne 'SIM' -or $target.customer.customerId -ne 'SIM-CUSTOMER-E2E-001' -or
        $target.assemblies[0].assemblyNumber -ne 'SIM-ASSY-001' -or $target.technicalReview.candidateBom) { throw 'Unexpected scenario state; refusing to submit.' }
    Copy-Item -LiteralPath $dataPath -Destination (Join-Path $folder 'intakes-before.json')
    Fingerprint | ConvertTo-Json -Depth 5 | Set-Content (Join-Path $folder 'hashes-before.json')
    & (Join-Path $repo 'Tools/SimRuntime/Stop-DleOsSim.ps1') -Json
    & (Join-Path $repo 'Tools/SimRuntime/DesktopControls/Start-DleOsSimServer.ps1')
    if ($LASTEXITCODE -ne 0) { throw 'SIM restart failed.' }
    $session=Session
    if ((Get-FileHash $dataPath).Hash -ne (Get-FileHash (Join-Path $folder 'intakes-before.json')).Hash) { throw 'Restart changed intake state.' }
    $job=Invoke-RestMethod ($profile.url+'/api/sim/technical-reviews/RFQI-SIM-0042/analysis-jobs') -Method Post -WebSession $session
    if ($job.input.resultVersion -ne 'DLE_CANDIDATE_ANALYSIS_RESULT_V2' -or $job.input.providerRoute -ne 'LOCAL_DOCUMENT') { throw 'Wrong extraction contract.' }
    $job | ConvertTo-Json -Depth 100 | Set-Content (Join-Path $folder 'submitted-job.json')
}
$session=Session
$deadline=[DateTimeOffset]::UtcNow.AddSeconds(60)
do {
    $latest=Invoke-RestMethod ($profile.url+'/api/sim/technical-reviews/RFQI-SIM-0042/analysis-jobs/latest') -WebSession $session
    if ($latest.job.status -notin @('QUEUED','RUNNING','VALIDATING')) { break }
    Start-Sleep -Milliseconds 500
} while ([DateTimeOffset]::UtcNow -lt $deadline)
if ($latest.job.status -ne 'SUCCEEDED') { $latest | ConvertTo-Json -Depth 20; throw 'Analysis did not succeed; checkpoint preserved for diagnosis.' }
$review=Invoke-RestMethod ($profile.url+'/api/sim/technical-reviews/RFQI-SIM-0042') -WebSession $session
$candidate=$review.record.technicalReview.candidateBom
if ($candidate.rows.Count -ne 12 -or $candidate.governingDocumentId -ne '5c8db6b9-eb37-499c-a168-b65f292fd6a7') { throw 'Wrong candidate source or row count.' }
$expected=@(
    @('SIM-PCB-001','1','PCB1'),@('SIM-R-1K','2','R1 R2'),@('SIM-R-10K','2','R3 R4'),
    @('SIM-C-100N','2','C1 C2'),@('SIM-OPTO-4','2','U1 U2'),@('SIM-J-4','2','J1 J2'),
    @('SIM-LED-G','2','D1 D2'),@('SIM-D-REV','2','D3 D4'),@('SIM-TP','4','TP1 TP2 TP3 TP4'),
    @('SIM-HW-M3','4','H1 H2 H3 H4'),@('SIM-LABEL','1','LBL1'),@('SIM-BAG','1','PKG1'))
for ($i=0;$i -lt 12;$i++) {
    $v=$candidate.rows[$i].values
    if ($v.partNumber -ne $expected[$i][0] -or $v.quantity -ne $expected[$i][1] -or $v.designators -ne $expected[$i][2]) { throw "BOM mismatch at row $i" }
    if ($candidate.rows[$i].confirmed) { throw 'Candidate was unexpectedly approved.' }
}
$before=Get-Content (Join-Path $folder 'intakes-before.json') -Raw | ConvertFrom-Json
$after=Get-Content $dataPath -Raw | ConvertFrom-Json
if ((Canonical @($before.records | Where-Object intakeId -ne 'RFQI-SIM-0042')) -cne (Canonical @($after.records | Where-Object intakeId -ne 'RFQI-SIM-0042'))) { throw 'Unrelated intake changed.' }
$old=$before.records | Where-Object intakeId -eq 'RFQI-SIM-0042'
$new=$after.records | Where-Object intakeId -eq 'RFQI-SIM-0042'
foreach ($field in @('technicalPackage','workflow','bomAcceptances')) {
    if ((Canonical $old.technicalReview.$field) -cne (Canonical $new.technicalReview.$field)) { throw "Reviewed checkpoint changed: $field" }
}
if ((Canonical $old.technicalFiles) -cne (Canonical $new.technicalFiles)) { throw 'Customer documents changed.' }
$oldJobs=@($before.analysisJobs)
foreach ($j in $oldJobs) {
    if ((Canonical $j) -cne (Canonical ($after.analysisJobs | Where-Object {$_.input.jobId -eq $j.input.jobId}))) { throw 'Existing analysis job changed.' }
}
if ($after.analysisJobs.Count -ne $oldJobs.Count+1) { throw 'Unexpected analysis job count.' }
$hashes=Get-Content (Join-Path $folder 'hashes-before.json') -Raw | ConvertFrom-Json -AsHashtable
$current=Fingerprint
if ($hashes.Count -ne $current.Count) { throw 'Business file inventory changed.' }
foreach ($key in $hashes.Keys) { if ($key -ne '.sim-state\data\rfq-intakes.json' -and $hashes[$key] -ne $current[$key]) { throw "Unrelated business file changed: $key" } }
$review | ConvertTo-Json -Depth 100 | Set-Content (Join-Path $folder 'review-after.json')
@{result='PASS';intake='RFQI-SIM-0042';candidateId=$candidate.id;jobId=$latest.job.input.jobId;rows=12;coverage=$candidate.analysis.coverage;governingDocumentId=$candidate.governingDocumentId;sha256=$candidate.governingSha256;productionDrawingId=$new.technicalReview.workflow.manufacturing.governingDocumentId;unchangedOtherBusinessFiles=$hashes.Count-1;unchangedOtherIntakes=@($before.records | Where-Object intakeId -ne 'RFQI-SIM-0042').Count;unapprovedCandidate=$true;validatedAtUtc=[DateTimeOffset]::UtcNow.ToString('O')} | ConvertTo-Json | Set-Content (Join-Path $folder 'verification.json')
Get-Content (Join-Path $folder 'verification.json')
