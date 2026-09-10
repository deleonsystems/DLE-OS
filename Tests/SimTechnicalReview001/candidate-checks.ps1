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
$candidatePayload.assemblies = @(@{lineNumber=1;assemblyNumber='B11283-17';revision='B';quantity=1})
$candidatePayload.technicalFiles = @($candidateFile)
$candidateCreated = Invoke-SimHttp $session 'POST' '/api/sim/rfq-intakes' $candidatePayload
Require ($candidateCreated.Status -eq 201) 'isolated candidate fixture submitted through staged Intake persistence'
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
$candidateSaved = Invoke-SimHttp $session 'PUT' "$candidateBase/disposition" @{disposition='NO_LONGER_REQUIRED'}
Require ($candidateSaved.Body.record.technicalReview.candidateBom.id -eq $candidate.id) 'Save closure retains candidate review'
$closedCandidate = Invoke-SimHttp $session 'POST' "$candidateBase/candidate-bom" $null
Require ($closedCandidate.Status -eq 409) 'closed review candidate cannot be mutated'
