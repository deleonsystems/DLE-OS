# Runs inside run-tests.ps1's isolated fixture lifecycle and dataset restore.
$python = Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe'
if ($env:DLE_OS_SIM_BOM_PYTHON) { $python = $env:DLE_OS_SIM_BOM_PYTHON }
$candidatePdf = Join-Path $testRoot 'candidate-fixture.pdf'
& $python (Join-Path $PSScriptRoot 'candidate_fixture.py') $candidatePdf
Require ($LASTEXITCODE -eq 0) 'candidate parser extracts real fixture bytes and rejects invalid input'
$candidateDraft = [guid]::NewGuid().ToString()
$candidateBytes = [IO.File]::ReadAllBytes($candidatePdf)
$candidateFile = Invoke-RestMethod "$baseUri/api/sim/intake-drafts/$candidateDraft/documents?name=unrelated-name.pdf" -Method Post -WebSession $session -Headers @{'X-SIM-Document-Upload'='1'} -ContentType 'application/octet-stream' -Body $candidateBytes
$candidatePayload = $payload.Clone()
$candidatePayload.requestCorrelationId = $candidateDraft
$candidatePayload.preliminaryAssemblyType = @{type='PCB_ASSEMBLY'}
$candidatePayload.assemblies = @(@{lineNumber=1;assemblyNumber='B11283-17';revision='B';quantity=1})
$candidateFile | Add-Member -NotePropertyName initialIdentification -NotePropertyValue @{type='DRAWING_AND_BOM';identifiedBy='FORGED';identifiedAtUtc='2000-01-01T00:00:00Z'} -Force
$candidatePayload.technicalFiles = @($candidateFile)
$candidateCreated = Invoke-SimHttp $session 'POST' '/api/sim/rfq-intakes' $candidatePayload
Require ($candidateCreated.Status -eq 201) 'isolated candidate fixture submitted through staged Intake persistence'
Require ($candidateCreated.Body.record.technicalFiles[0].initialIdentification.type -eq 'DRAWING_AND_BOM' -and $candidateCreated.Body.record.technicalFiles[0].initialIdentification.identifiedBy -ne 'FORGED' -and $candidateCreated.Body.record.technicalFiles[0].initialIdentification.identifiedAtUtc.Year -ne 2000) 'verified document retains preliminary identification with server-derived actor/time'
$candidateId = $candidateCreated.Body.record.intakeId
$candidateBase = "/api/sim/technical-reviews/$candidateId"
$null = Invoke-SimHttp $session 'PUT' "$candidateBase/disposition" @{disposition='START_TECHNICAL_REVIEW'}
$null = Invoke-SimHttp $session 'PUT' "$candidateBase/assembly-classification" @{assemblyClassification='EXISTING_ASSEMBLY'}
$noSource = Invoke-SimHttp $session 'POST' "$candidateBase/candidate-bom" $null
Require ($noSource.Status -eq 409) 'candidate requires explicit governing PDF classification'
$candidatePackage = @{documents=@(@{documentId=$candidateFile.documentId;name=$candidateFile.name;documentType='ASSEMBLY_DRAWING';role='GOVERNING';applicability='PARENT_ASSEMBLY';embeddedBom=$true});governingBomDocumentId=$candidateFile.documentId}
$null = Invoke-SimHttp $session 'PUT' "$candidateBase/technical-package" $candidatePackage
$candidateDenied = Invoke-SimHttp $viewer 'POST' "$candidateBase/candidate-bom" $null
Require ($candidateDenied.Status -eq 403) 'candidate extraction requires review permission'
$built = Invoke-SimHttp $session 'POST' "$candidateBase/candidate-bom" $null
if ($built.Status -ne 200) { Write-Host ($built.Body | ConvertTo-Json -Compress) }
$candidate = $built.Body.record.technicalReview.candidateBom
Require ($built.Status -eq 200 -and $candidate.rows.Count -eq 10 -and $candidate.rows[0].extracted.partNumber -eq 'REAL-BYTE-INPUT') 'candidate is extracted from staged bytes, not filename fixtures'
Require (-not $candidate.synthetic -and $candidate.page -eq 2 -and $candidate.governingDocumentId -eq $candidateFile.documentId -and $candidate.governingSha256.Length -eq 64) 'candidate retains real marker, document identity, page and hash'
Require ($candidate.rows[0].comparison.partNumber -eq 'UNCERTAIN' -and $candidate.supportingComparison -like 'UNAVAILABLE*') 'unavailable supporting comparison never claims a match'
$values = @{lineNumber='1';partNumber='HUMAN-CORRECTION';quantity='1';designators='C1';description='Test component'}
$corrected = Invoke-SimHttp $session 'PUT' "$candidateBase/candidate-bom" @{candidateId=$candidate.id;rowIndex=0;values=$values}
$row = $corrected.Body.record.technicalReview.candidateBom.rows[0]
Require ($corrected.Status -eq 200 -and $row.extracted.partNumber -eq 'REAL-BYTE-INPUT' -and $row.values.partNumber -eq 'HUMAN-CORRECTION' -and $row.confirmed -and $row.corrections[0].reviewer -and $row.corrections[0].atUtc) 'human correction preserves original extraction and audit history'
$bad = Invoke-SimHttp $session 'PUT' "$candidateBase/candidate-bom" @{candidateId='stale';rowIndex=0;values=$values}
Require ($bad.Status -eq 409) 'stale candidate review is rejected'
$values.quantity = '-1'
$bad = Invoke-SimHttp $session 'PUT' "$candidateBase/candidate-bom" @{candidateId=$candidate.id;rowIndex=0;values=$values}
Require ($bad.Status -eq 400) 'invalid candidate quantity is rejected'
$repeated = Invoke-SimHttp $session 'POST' "$candidateBase/candidate-bom" $null
Require ($repeated.Body.record.technicalReview.candidateBom.rows[0].values.partNumber -eq 'HUMAN-CORRECTION') 'repeat build resumes candidate without overwriting human correction'
$binaryAfter = Invoke-WebRequest "$baseUri/api/sim/rfq-intakes/$candidateId/documents/$($candidateFile.documentId)" -WebSession $session
Require ([Convert]::ToHexString([Security.Cryptography.SHA256]::HashData([byte[]]$binaryAfter.Content)) -eq [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($candidateBytes))) 'candidate review does not modify staged source binary'
Require ($repeated.Body.record.status -eq 'TECHNICAL_REVIEW_IN_PROGRESS' -and -not $repeated.Body.record.technicalReview.downstreamHandoffTarget -and -not $repeated.Body.record.technicalReview.materialsDefinition) 'candidate creates no canonical BOM, synthetic comparison or downstream work'
$alternateBody = @{candidateId=$candidate.id;rowIndex=0;alternateChange=@{action='ADD';partNumber='SYNTHETIC-ALT';expectedRevision=0}}
$alternateDenied = Invoke-SimHttp $viewer 'PUT' "$candidateBase/candidate-bom" $alternateBody
Require ($alternateDenied.Status -eq 403) 'alternate changes require review permission'
$alternateAdded = Invoke-SimHttp $session 'PUT' "$candidateBase/candidate-bom" $alternateBody
$alternateRow = $alternateAdded.Body.record.technicalReview.candidateBom.rows[0]
Require ($alternateAdded.Status -eq 200 -and $alternateRow.alternates[0].partNumber -eq 'SYNTHETIC-ALT' -and $alternateRow.alternates[0].origin -eq 'MANUAL') 'alternate persists through candidate HTTP boundary'
$alternateBody.alternateChange = @{action='EDIT';id=$alternateRow.alternates[0].id;partNumber='SYNTHETIC-ALT-CORRECTED';reviewStatus='CONFIRMED';expectedRevision=1}
$alternateEdited = Invoke-SimHttp $session 'PUT' "$candidateBase/candidate-bom" $alternateBody
Require ($alternateEdited.Status -eq 200 -and $alternateEdited.Body.record.technicalReview.candidateBom.rows[0].alternates[0].history.Count -eq 2) 'alternate correction persists with audit through HTTP'
$typedCandidate = Invoke-SimHttp $session 'PUT' "$candidateBase/candidate-bom" @{candidateId=$candidate.id;rowIndex=0;componentChange=@{componentType='SUBASSEMBLY';expectedRevision=0}}
Require ($typedCandidate.Status -eq 200 -and $typedCandidate.Body.record.technicalReview.candidateBom.rows[0].componentType -eq 'SUBASSEMBLY') 'main-table component classification persists through HTTP'
# RFQ-scoped BOM completion: unresolved state, concurrency, immutable acceptance.
$completion = Invoke-SimHttp $session 'POST' "$candidateBase/complete-bom-review" @{candidate=$typedCandidate.Body.record.technicalReview.candidateBom}
if ($completion.Status -ne 409 -or $completion.Body.message -notlike '*rows:*') { Write-Host ($completion | ConvertTo-Json -Depth 5) }
Require ($completion.Status -eq 409 -and $completion.Body.message -like '*rows:*') 'unreviewed candidate rows block completion with actionable explanation'
$deniedCompletion = Invoke-SimHttp $viewer 'POST' "$candidateBase/complete-bom-review" @{candidate=$typedCandidate.Body.record.technicalReview.candidateBom}
Require ($deniedCompletion.Status -eq 403) 'BOM completion requires review permission'
$current = $typedCandidate.Body.record.technicalReview.candidateBom
foreach ($i in 0..($current.rows.Count-1)) {
    $reviewed = Invoke-SimHttp $session 'PUT' "$candidateBase/candidate-bom" @{candidateId=$candidate.id;rowIndex=$i;values=$current.rows[$i].values}
    Require ($reviewed.Status -eq 200) "row $i confirmed for isolated completion"
}
$staleCompletion = Invoke-SimHttp $session 'POST' "$candidateBase/complete-bom-review" @{candidate=$current}
Require ($staleCompletion.Status -eq 409) 'completion rejects a stale browser snapshot even with the same candidate ID'
$current = $reviewed.Body.record.technicalReview.candidateBom
$completion = Invoke-SimHttp $session 'POST' "$candidateBase/complete-bom-review" @{candidate=$current}
Require ($completion.Status -eq 200) 'fully reviewed synthetic BOM completes'
$accepted = $completion.Body.record.technicalReview.bomAcceptances[0]
Require ($accepted.candidate.id -eq $candidate.id -and $accepted.version -eq 1 -and $accepted.reviewedBy -and $accepted.reviewedAtUtc) 'exact accepted candidate and reviewer timestamp persist'
Require (($accepted.candidate | ConvertTo-Json -Depth 40 -Compress) -eq ($current | ConvertTo-Json -Depth 40 -Compress)) 'acceptance snapshot preserves every candidate field including evidence and audit'
Require ($completion.Body.record.technicalReview.materialsReviewStatus -eq 'QUALIFIED' -and $completion.Body.record.technicalReview.nextReviewPhase -eq 'MANUFACTURING_LABOR_REVIEW' -and $completion.Body.record.status -eq 'TECHNICAL_REVIEW_IN_PROGRESS') 'materials qualification is separate from overall review and next phase remains manufacturing labor'
$repeatCompletion = Invoke-SimHttp $session 'POST' "$candidateBase/complete-bom-review" @{candidate=$current}
Require ($repeatCompletion.Body.record.technicalReview.bomAcceptances.Count -eq 1) 'repeated completion does not duplicate accepted versions'
$frozen = Invoke-SimHttp $session 'PUT' "$candidateBase/candidate-bom" @{candidateId=$candidate.id;rowIndex=0;values=$current.rows[0].values}
Require ($frozen.Status -eq 409 -and $frozen.Body.message -like '*read-only*') 'accepted candidate rejects later in-place edits'
$candidateSaved = Invoke-SimHttp $session 'PUT' "$candidateBase/disposition" @{disposition='NO_LONGER_REQUIRED'}
Require ($candidateSaved.Body.record.technicalReview.candidateBom.id -eq $candidate.id) 'Save closure retains candidate review'
$closedCandidate = Invoke-SimHttp $session 'POST' "$candidateBase/candidate-bom" $null
Require ($closedCandidate.Status -eq 409) 'closed review candidate cannot be mutated'
$closedAlternate = Invoke-SimHttp $session 'PUT' "$candidateBase/candidate-bom" $alternateBody
Require ($closedAlternate.Status -eq 409) 'closed review alternate cannot be mutated'
