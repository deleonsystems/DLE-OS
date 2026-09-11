[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$repository = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$project = Join-Path $repository 'Tools\SimRuntime\DleOs.SimHost\DleOs.SimHost.csproj'
$testPort = 5191
$baseUri = "http://127.0.0.1:$testPort"
$testRoot = Join-Path $repository '.sim-state\technical-review-qualification'
$stdout = Join-Path $testRoot 'host.stdout.log'
$stderr = Join-Path $testRoot 'host.stderr.log'
$buildRoot = Join-Path $testRoot 'build'
$datasetPath = Join-Path $repository '.sim-state\data\rfq-intakes.json'
$datasetBackup = Join-Path $testRoot 'rfq-intakes.before-test.json'
$runtimeMetadataPath = Join-Path $repository '.sim-state\runtime\runtime.json'
$savedRuntimeMetadata = if (Test-Path $runtimeMetadataPath) { [IO.File]::ReadAllText($runtimeMetadataPath) } else { $null }
$datasetExisted = Test-Path $datasetPath
$checks = [Collections.Generic.List[string]]::new()

function Require($Condition, [string] $Message) {
    if (-not [bool]$Condition) { throw "FAIL: $Message" }
    $checks.Add($Message)
}

function Invoke-SimHttp([Microsoft.PowerShell.Commands.WebRequestSession] $Session,
    [string] $Method, [string] $Path, [object] $Body) {
    $parameters = @{ Uri = $baseUri + $Path; Method = $Method; WebSession = $Session;
        UseBasicParsing = $true; TimeoutSec = 5; ErrorAction = 'Stop' }
    if ($null -ne $Body) { $parameters.ContentType = 'application/json'; $parameters.Body = $Body | ConvertTo-Json -Compress -Depth 16 }
    try { $response = Invoke-WebRequest @parameters; return [pscustomobject]@{ Status = [int]$response.StatusCode; Body = $response.Content | ConvertFrom-Json } }
    catch { return [pscustomobject]@{ Status = [int]$_.Exception.Response.StatusCode; Body = ([string]$_.ErrorDetails.Message | ConvertFrom-Json) } }
}

New-Item -ItemType Directory -Path $testRoot -Force | Out-Null
if ($datasetExisted) { Copy-Item -LiteralPath $datasetPath -Destination $datasetBackup -Force }
& dotnet build $project --nologo --verbosity quiet -p:UseAppHost=false -p:OutputPath="$buildRoot\bin\"
if ($LASTEXITCODE -ne 0) { throw 'FAIL: SIM host build failed.' }
$checks.Add('SIM host builds with Technical Review persistence')
& node (Join-Path $PSScriptRoot 'run-ui-contract-tests.mjs')
if ($LASTEXITCODE -ne 0) { throw 'FAIL: Technical Review UI contract failed.' }
$checks.Add('Technical Review UI contracts pass')
& node (Join-Path $PSScriptRoot 'run-guided-review-tests.mjs')
if ($LASTEXITCODE -ne 0) { throw 'FAIL: guided review behavior tests failed.' }
$checks.Add('guided review behavior tests pass')

$existing = Get-NetTCPConnection -State Listen -LocalPort $testPort -ErrorAction SilentlyContinue
Require ($null -eq $existing) 'qualification port is free'
$hostProcess = $null
try {
    $env:DLE_OS_SIM_PORT = [string]$testPort
    $dll = Join-Path $buildRoot 'bin\DleOs.SimHost.dll'
    $hostProcess = Start-Process dotnet -ArgumentList @($dll) -WorkingDirectory $repository `
        -RedirectStandardOutput $stdout -RedirectStandardError $stderr -PassThru -WindowStyle Hidden
    Remove-Item Env:DLE_OS_SIM_PORT -ErrorAction SilentlyContinue
    $ready = $false
    for ($attempt = 0; $attempt -lt 50; $attempt++) {
        try { if ((Invoke-RestMethod "$baseUri/api/sim/status" -TimeoutSec 1).status -eq 'READY') { $ready = $true; break } }
        catch { Start-Sleep -Milliseconds 100 }
    }
    Require $ready 'SIM starts and reports READY'
    $session = [Microsoft.PowerShell.Commands.WebRequestSession]::new()
    $payload = @{
        intakeType = 'NEW_QUOTE_REQUEST'
        customer = @{ customerId = 'SIM-CUSTOMER-ABBOTT'; customerNumber = '990100'; customerName = 'Abbott'; resolutionSource = 'sim-canonical-customer-directory' }
        assemblyCount = 1
        assemblies = @(@{ lineNumber = 1; assemblyNumber = 'B11283-17'; revision = 'B'; quantity = 25 })
        deLeonScope = 'MATERIAL_AND_LABOR'
        technicalFilesProvided = $true
        technicalFiles = @(
            @{ name = 'B11283-17_Assembly_Drawing_Rev_B.pdf'; size = 1024; type = 'application/pdf'; lastModified = 1 },
            @{ name = 'B11283-17_BOM_Rev_B.xlsx'; size = 2048; type = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'; lastModified = 2 },
            @{ name = 'B11283-17_Gerbers_Rev_B.zip'; size = 4096; type = 'application/zip'; lastModified = 3 },
            @{ name = 'B11283-17_Subassembly_Spec.pdf'; size = 768; type = 'application/pdf'; lastModified = 4 }
        )
        customerRequirements = @('PRICE', 'LEAD_TIME')
        createdBy = 'SIM Intake User'
        requestCorrelationId = [guid]::NewGuid().ToString()
    }
    $created = Invoke-SimHttp $session 'POST' '/api/sim/rfq-intakes' $payload
    Require ($created.Status -eq 201 -and $created.Body.record.handoffTarget -eq 'Technical Review') 'Intake submits to Technical Review without starting review'
    $intakeId = $created.Body.record.intakeId
    $queue = Invoke-SimHttp $session 'GET' '/api/sim/technical-reviews' $null
    $queued = $queue.Body.items | Where-Object intakeId -EQ $intakeId
    Require ($queue.Status -eq 200 -and $queued.reviewTypeLabel -eq 'RFQ Review' -and $queued.reviewStatusLabel -eq 'Needs Technical Review') 'Abbott appears in the queue as RFQ Review needing Technical Review'
    Require ($queued.customer.customerName -eq 'Abbott' -and $queued.assembly.assemblyNumber -eq 'B11283-17' -and $queued.assembly.revision -eq 'B' -and $queued.assembly.quantity -eq 25) 'queue preserves Abbott assembly identity and quantity'
    Require ($queued.documentPreservationState -eq 'METADATA_PRESERVED_SOURCE_PLACEMENT_REQUIRED') 'queue remains truthful about metadata-only document preservation'
    $detail = Invoke-SimHttp $session 'GET' "/api/sim/technical-reviews/$intakeId" $null
    Require ($detail.Status -eq 200 -and $detail.Body.record.deLeonScope -eq 'MATERIAL_AND_LABOR') 'review detail opens the persisted Intake record'

    $started = Invoke-SimHttp $session 'PUT' "/api/sim/technical-reviews/$intakeId/disposition" @{ disposition = 'START_TECHNICAL_REVIEW' }
    Require ($started.Status -eq 200 -and $started.Body.record.status -eq 'TECHNICAL_REVIEW_IN_PROGRESS') 'Start persists in-progress state without qualification fields'
    $queue = Invoke-SimHttp $session 'GET' '/api/sim/technical-reviews' $null
    Require (@($queue.Body.items | Where-Object intakeId -EQ $intakeId).Count -eq 1) 'started review remains active'
    $payload.requestCorrelationId = [guid]::NewGuid().ToString()
    $closeFixture = Invoke-SimHttp $session 'POST' '/api/sim/rfq-intakes' $payload
    $closeId = $closeFixture.Body.record.intakeId
    $closed = Invoke-SimHttp $session 'PUT' "/api/sim/technical-reviews/$closeId/disposition" @{ disposition = 'NO_LONGER_REQUIRED' }
    Require ($closed.Status -eq 200 -and $closed.Body.record.status -eq 'NO_LONGER_REQUIRED' -and $closed.Body.record.technicalReview.disposition -eq 'NO_LONGER_REQUIRED') 'No Longer Required closes without qualification fields'
    Require ($closed.Body.record.technicalReview.reviewedBy -and $closed.Body.record.technicalReview.reviewedAtUtc) 'closure captures SIM reviewer and timestamp'
    $queue = Invoke-SimHttp $session 'GET' '/api/sim/technical-reviews' $null
    Require (@($queue.Body.items | Where-Object intakeId -EQ $closeId).Count -eq 0) 'fresh active queue excludes closed review'
    $preserved = Invoke-SimHttp $session 'GET' "/api/sim/rfq-intakes/$closeId" $null
    Require ($preserved.Status -eq 200 -and $preserved.Body.createdAtUtc -eq $closeFixture.Body.record.createdAtUtc -and $preserved.Body.requestCorrelationId -eq $payload.requestCorrelationId -and $preserved.Body.technicalFiles.Count -eq 4) 'originating intake identity, creation timestamp, correlation and files remain preserved'
    $history = Invoke-SimHttp $session 'GET' "/api/sim/technical-reviews/$closeId" $null
    Require ($history.Status -eq 200 -and $history.Body.record.status -eq 'NO_LONGER_REQUIRED') 'closed review remains readable by identifier'
    $repeat = Invoke-SimHttp $session 'PUT' "/api/sim/technical-reviews/$closeId/disposition" @{ disposition = 'NO_LONGER_REQUIRED' }
    Require ($repeat.Body.record.technicalReview.reviewedAtUtc -eq $closed.Body.record.technicalReview.reviewedAtUtc) 'repeated closure preserves original audit timestamp'
    $reopen = Invoke-SimHttp $session 'PUT' "/api/sim/technical-reviews/$closeId/disposition" @{ disposition = 'START_TECHNICAL_REVIEW' }
    Require ($reopen.Status -eq 400) 'stale Start cannot reopen a closed review'
    $disk = Get-Content -LiteralPath $datasetPath -Raw | ConvertFrom-Json
    Require (($disk.records | Where-Object intakeId -EQ $closeId).status -eq 'NO_LONGER_REQUIRED') 'closed disposition is written to the existing JSON dataset'

    $payload.requestCorrelationId = [guid]::NewGuid().ToString()
    $deleteFixture = Invoke-SimHttp $session 'POST' '/api/sim/rfq-intakes' $payload
    $deleteId = $deleteFixture.Body.record.intakeId
    # Reproduce RFQI-SIM-0004's legacy routing label only on this disposable fixture.
    $legacyDataset = Get-Content -LiteralPath $datasetPath -Raw | ConvertFrom-Json
    ($legacyDataset.records | Where-Object intakeId -EQ $deleteId).handoffTarget = 'RFQ Qualification'
    [IO.File]::WriteAllText($datasetPath, ($legacyDataset | ConvertTo-Json -Depth 20))
    $legacyDetail = Invoke-SimHttp $session 'GET' "/api/sim/technical-reviews/$deleteId" $null
    Require ($legacyDetail.Body.deletionEligibility.allowed -and $null -eq $legacyDetail.Body.record.technicalReview) 'legacy RFQ Qualification routing is deletable before review starts'
    $viewer = [Microsoft.PowerShell.Commands.WebRequestSession]::new()
    $null = Invoke-SimHttp $viewer 'POST' '/api/sim/persona' @{ personaId = 'read-only-viewer' }
    $deniedDelete = Invoke-SimHttp $viewer 'DELETE' "/api/sim/technical-reviews/$deleteId" $null
    Require ($deniedDelete.Status -eq 403) 'Delete requires existing Technical Review disposition permission'
    $null = Invoke-SimHttp $session 'PUT' "/api/sim/technical-reviews/$deleteId/disposition" @{ disposition = 'START_TECHNICAL_REVIEW' }
    $deleted = Invoke-SimHttp $session 'DELETE' "/api/sim/technical-reviews/$deleteId" $null
    Require ($deleted.Status -eq 200 -and $deleted.Body.deleted -and $deleted.Body.intakeId -eq $deleteId) 'Delete removes an early-stage intake with embedded in-progress review'
    $missingIntake = Invoke-SimHttp $session 'GET' "/api/sim/rfq-intakes/$deleteId" $null
    $missingReview = Invoke-SimHttp $session 'GET' "/api/sim/technical-reviews/$deleteId" $null
    Require ($missingIntake.Status -eq 404 -and $missingReview.Status -eq 404) 'deleted intake and review both return 404'
    $afterDelete = Get-Content -LiteralPath $datasetPath -Raw | ConvertFrom-Json
    Require (@($afterDelete.records | Where-Object intakeId -EQ $deleteId).Count -eq 0) 'Delete removes the persisted record rather than preserving a closed record'
    Require (($afterDelete.records | ConvertTo-Json -Depth 20 -Compress) -eq ($disk.records | ConvertTo-Json -Depth 20 -Compress)) 'Delete leaves every other persisted intake/review unchanged'
    $queue = Invoke-SimHttp $session 'GET' '/api/sim/technical-reviews' $null
    Require (@($queue.Body.items | Where-Object intakeId -EQ $deleteId).Count -eq 0) 'deleted item is absent from a fresh active queue'
    $repeatDelete = Invoke-SimHttp $session 'DELETE' "/api/sim/technical-reviews/$deleteId" $null
    Require ($repeatDelete.Status -eq 404) 'repeated Delete cannot remove another record'
    $payload.requestCorrelationId = [guid]::NewGuid().ToString()
    $nextFixture = Invoke-SimHttp $session 'POST' '/api/sim/rfq-intakes' $payload
    $nextId = $nextFixture.Body.record.intakeId
    Require ([long]$nextId.Substring(9) -gt [long]$deleteId.Substring(9)) 'new intake never reuses the deleted highest ID'

    # Fail closed for downstream markers even if a stale top-level status still looks open.
    $guardDataset = Get-Content -LiteralPath $datasetPath -Raw | ConvertFrom-Json
    $guardRecord = $guardDataset.records | Where-Object intakeId -EQ $nextId
    $guardRecord.technicalReview = $started.Body.record.technicalReview
    $guardRecord.technicalReview.downstreamHandoffTarget = 'sim://rfq-work/linked-artifact-fixture'
    $guardRecord.technicalReview.downstreamHandoffState = 'ACTIVE'
    [IO.File]::WriteAllText($datasetPath, ($guardDataset | ConvertTo-Json -Depth 20))
    $unsafeDelete = Invoke-SimHttp $session 'DELETE' "/api/sim/technical-reviews/$nextId" $null
    Require ($unsafeDelete.Status -eq 409 -and $unsafeDelete.Body.code -eq 'DLE_OS_SIM_TECHNICAL_REVIEW_DELETE_UNSAFE') 'explicit downstream artifact link blocks Delete even with an open intake status'
    $linkedRead = Invoke-SimHttp $session 'GET' "/api/sim/technical-reviews/$nextId" $null
    Require (-not $linkedRead.Body.deletionEligibility.allowed -and $linkedRead.Body.record.technicalReview.downstreamHandoffTarget -eq 'sim://rfq-work/linked-artifact-fixture') 'blocked deletion preserves downstream-link evidence and reports eligibility'
    $guardRecord.technicalReview = $null
    $guardRecord.status = 'FUTURE_UNKNOWN_STATE'
    [IO.File]::WriteAllText($datasetPath, ($guardDataset | ConvertTo-Json -Depth 20))
    $unknownDelete = Invoke-SimHttp $session 'DELETE' "/api/sim/technical-reviews/$nextId" $null
    Require ($unknownDelete.Status -eq 409) 'unknown lifecycle states block Delete'
    $guardRecord.status = 'READY_FOR_RFQ_QUALIFICATION'
    [IO.File]::WriteAllText($datasetPath, ($guardDataset | ConvertTo-Json -Depth 20))

    $payload.requestCorrelationId = [guid]::NewGuid().ToString()
    $historyFixture = Invoke-SimHttp $session 'POST' '/api/sim/rfq-intakes' $payload
    $historyId = $historyFixture.Body.record.intakeId
    $prematureMaterials = Invoke-SimHttp $session 'POST' "/api/sim/technical-reviews/$historyId/materials-definition" $null
    Require ($prematureMaterials.Status -eq 409) 'materials review requires confirmed history for a previously built revision'
    $beforeStart = Invoke-SimHttp $session 'POST' "/api/sim/technical-reviews/$historyId/assembly-history" $null
    Require ($beforeStart.Status -eq 409) 'history lookup requires an active started review'
    $null = Invoke-SimHttp $session 'PUT' "/api/sim/technical-reviews/$historyId/disposition" @{ disposition = 'START_TECHNICAL_REVIEW' }
    $historyResult = Invoke-SimHttp $session 'POST' "/api/sim/technical-reviews/$historyId/assembly-history" $null
    $history = $historyResult.Body.record.technicalReview.assemblyHistory
    Require ($historyResult.Status -eq 200 -and $history.lookupCompleted -and $history.historyFound -and $history.synthetic) 'Abbott history lookup persists a completed synthetic result'
    Require (($history.revisionsFound -join ',') -eq 'A,B' -and $history.mostRecentRevision -eq 'B' -and $history.records.Count -eq 2) 'provider returns prior revisions A and B with most recent B and build context'
    $mismatch = Invoke-SimHttp $session 'PUT' "/api/sim/technical-reviews/$historyId/assembly-classification" @{ assemblyClassification = 'NEW_ASSEMBLY' }
    Require ($mismatch.Status -eq 400) 'server rejects a classification inconsistent with found history'
    $confirmed = Invoke-SimHttp $session 'PUT' "/api/sim/technical-reviews/$historyId/assembly-classification" @{ assemblyClassification = 'EXISTING_ASSEMBLY' }
    Require ($confirmed.Body.record.technicalReview.assemblyHistory.assemblyClassification -eq 'EXISTING_ASSEMBLY' -and $confirmed.Body.record.technicalReview.assemblyHistory.confirmedBy -and $confirmed.Body.record.status -eq 'TECHNICAL_REVIEW_IN_PROGRESS') 'existing assembly determination records reviewer and stays active'
    $unselected = Invoke-SimHttp $session 'POST' "/api/sim/technical-reviews/$historyId/materials-definition" $null
    Require ($unselected.Status -eq 409) 'comparison never guesses the governing BOM from filename'
    $packageDocs = @(
      @{documentId='DOC-001';name=$payload.technicalFiles[0].name;documentType='ASSEMBLY_DRAWING';role='REFERENCED';applicability='PARENT_ASSEMBLY'},
      @{documentId='DOC-002';name=$payload.technicalFiles[1].name;documentType='BOM';role='GOVERNING';applicability='PARENT_ASSEMBLY'},
      @{documentId='DOC-003';name=$payload.technicalFiles[2].name;documentType='GERBER';role='SUPPORTING';applicability='SUPPORTING_REFERENCE'},
      @{documentId='DOC-004';name=$payload.technicalFiles[3].name;documentType='SUBASSEMBLY_BOM';role='REFERENCED';applicability='SUBASSEMBLY';subassemblyPartNumber='SUB-CONTROLLER'}
    )
    $packageSaved = Invoke-SimHttp $session 'PUT' "/api/sim/technical-reviews/$historyId/technical-package" @{documents=$packageDocs;governingBomDocumentId='DOC-002'}
    Require ($packageSaved.Status -eq 200 -and $packageSaved.Body.record.technicalReview.technicalPackage.documents.Count -eq 4) 'all received documents persist with type role applicability and explicit governing selection'
    $invalidPackage = Invoke-SimHttp $session 'PUT' "/api/sim/technical-reviews/$historyId/technical-package" @{documents=@($packageDocs[0]);governingBomDocumentId=$null}
    Require ($invalidPackage.Status -eq 400) 'inventory cannot omit received documents'
    $deniedPackage = Invoke-SimHttp $viewer 'PUT' "/api/sim/technical-reviews/$historyId/technical-package" @{documents=$packageDocs;governingBomDocumentId='DOC-002'}
    Require ($deniedPackage.Status -eq 403) 'inventory edits require review permission'
    $materials = Invoke-SimHttp $session 'POST' "/api/sim/technical-reviews/$historyId/materials-definition" $null
    $definition = $materials.Body.record.technicalReview.materialsDefinition
    Require ($materials.Status -eq 200 -and $definition.result -eq 'LOOKS_CONSISTENT' -and $definition.comparisonCompleted) 'current and historical synthetic BOMs compare consistently'
    Require ($definition.currentBom.reference -like '*BOM*' -and $definition.priorBom.reference -like '*SIM-BUILD-ABBOTT-002*' -and $definition.parentAssemblyMatch -and $definition.revisionMatch) 'comparison identifies current customer BOM and prior Rev B build association'
    Require ($definition.unchangedParts.Count -eq 3 -and $definition.currentLineCount -eq 3 -and $definition.priorLineCount -eq 3 -and $definition.addedParts.Count -eq 0 -and $definition.quantityChanges.Count -eq 0) 'happy-path line counts and unchanged quantities are computed'
    Require ($definition.subassemblies.Count -eq 1 -and $definition.subassemblies[0].technicalReference -eq 'SIM-PACKAGE-SUB-CONTROLLER-B') 'subassembly quantity and known package reference are surfaced'
    Require ($materials.Body.record.technicalReview.subassemblyCoverage[0].coverageState -eq 'COVERED' -and $materials.Body.record.technicalReview.subassemblyCoverage[0].customerDocumentIds[0] -eq 'DOC-004') 'coverage combines known history and applicable customer document identities'
    $repeatMaterials = Invoke-SimHttp $session 'POST' "/api/sim/technical-reviews/$historyId/materials-definition" $null
    Require ($repeatMaterials.Body.record.technicalReview.materialsDefinition.reviewedAtUtc -eq $definition.reviewedAtUtc) 'reopen preserves the materials snapshot and audit timestamp'
    $deniedMaterials = Invoke-SimHttp $viewer 'POST' "/api/sim/technical-reviews/$historyId/materials-definition" $null
    Require ($deniedMaterials.Status -eq 403) 'materials comparison requires review permission'
    $differencePayload = $payload.Clone()
    $differencePayload.requestCorrelationId = [guid]::NewGuid().ToString()
    $differencePayload.technicalFiles = @(@{name='SIM-BOM-DIFFERENCES.csv';size=100;type='text/csv';lastModified=0})
    $differenceFixture = Invoke-SimHttp $session 'POST' '/api/sim/rfq-intakes' $differencePayload
    $differenceId = $differenceFixture.Body.record.intakeId
    $null = Invoke-SimHttp $session 'PUT' "/api/sim/technical-reviews/$differenceId/disposition" @{disposition='START_TECHNICAL_REVIEW'}
    $null = Invoke-SimHttp $session 'POST' "/api/sim/technical-reviews/$differenceId/assembly-history" $null
    $null = Invoke-SimHttp $session 'PUT' "/api/sim/technical-reviews/$differenceId/assembly-classification" @{assemblyClassification='EXISTING_ASSEMBLY'}
    $diffDocs = @(@{documentId='DOC-001';name='SIM-BOM-DIFFERENCES.csv';documentType='BOM';role='GOVERNING';applicability='PARENT_ASSEMBLY'})
    $null = Invoke-SimHttp $session 'PUT' "/api/sim/technical-reviews/$differenceId/technical-package" @{documents=$diffDocs;governingBomDocumentId='DOC-001'}
    $difference = Invoke-SimHttp $session 'POST' "/api/sim/technical-reviews/$differenceId/materials-definition" $null
    $diff = $difference.Body.record.technicalReview.materialsDefinition
    Require ($diff.result -eq 'DIFFERENCES_FOUND' -and $diff.addedParts[0] -eq 'LED-20' -and $diff.removedParts[0] -eq 'C-10' -and $diff.quantityChanges[0].priorQuantity -eq 2 -and $diff.quantityChanges[0].currentQuantity -eq 3) 'controlled difference fixture computes added, removed and quantity changes'
    Require ($null -eq $diff.subassemblies[0].technicalReference -and $difference.Body.record.status -eq 'TECHNICAL_REVIEW_IN_PROGRESS') 'missing subassembly reference needs attention without qualifying or closing the review'
    Require ($difference.Body.record.technicalReview.subassemblyCoverage[0].coverageState -eq 'UNRESOLVED') 'subassembly without history or applicable customer definition remains unresolved'
    $savedDifference = Invoke-SimHttp $session 'PUT' "/api/sim/technical-reviews/$differenceId/disposition" @{disposition='NO_LONGER_REQUIRED'}
    Require ($savedDifference.Body.record.technicalReview.materialsDefinition.result -eq 'DIFFERENCES_FOUND') 'Save disposition preserves the materials comparison snapshot'
    $closedMaterials = Invoke-SimHttp $session 'POST' "/api/sim/technical-reviews/$differenceId/materials-definition" $null
    Require ($closedMaterials.Status -eq 409) 'materials endpoint cannot mutate closed reviews'
    $ambiguousPayload = $payload.Clone()
    $ambiguousPayload.requestCorrelationId = [guid]::NewGuid().ToString()
    $ambiguousPayload.technicalFiles = @(
      @{name='parent-one.csv';size=1;type='text/csv';lastModified=0},
      @{name='SIM-BOM-DIFFERENCES.csv';size=1;type='text/csv';lastModified=0},
      @{name='approval.pdf';size=1;type='application/pdf';lastModified=0},
      @{name='controller.csv';size=1;type='text/csv';lastModified=0}
    )
    $ambiguous = Invoke-SimHttp $session 'POST' '/api/sim/rfq-intakes' $ambiguousPayload
    $ambiguousId = $ambiguous.Body.record.intakeId
    $null = Invoke-SimHttp $session 'PUT' "/api/sim/technical-reviews/$ambiguousId/disposition" @{disposition='START_TECHNICAL_REVIEW'}
    $null = Invoke-SimHttp $session 'PUT' "/api/sim/technical-reviews/$ambiguousId/assembly-classification" @{assemblyClassification='EXISTING_ASSEMBLY'}
    $ambiguousDocs = @(
      @{documentId='DOC-001';name='parent-one.csv';documentType='BOM';role='UNRESOLVED';applicability='PARENT_ASSEMBLY'},
      @{documentId='DOC-002';name='SIM-BOM-DIFFERENCES.csv';documentType='BOM';role='UNRESOLVED';applicability='PARENT_ASSEMBLY'},
      @{documentId='DOC-003';name='approval.pdf';documentType='ALTERNATE_PART_APPROVAL';role='SUPPORTING';applicability='SUPPORTING_REFERENCE'},
      @{documentId='DOC-004';name='controller.csv';documentType='SUBASSEMBLY_BOM';role='UNRESOLVED';applicability='SUBASSEMBLY';subassemblyPartNumber='SUB-CONTROLLER'}
    )
    $unresolvedPackage = Invoke-SimHttp $session 'PUT' "/api/sim/technical-reviews/$ambiguousId/technical-package" @{documents=$ambiguousDocs}
    Require ($unresolvedPackage.Status -eq 200 -and $null -eq $unresolvedPackage.Body.record.technicalReview.technicalPackage.governingBomDocumentId) 'multiple parent BOMs coexist with unresolved roles and no inferred selection'
    $unresolvedComparison = Invoke-SimHttp $session 'POST' "/api/sim/technical-reviews/$ambiguousId/materials-definition" $null
    Require ($unresolvedComparison.Status -eq 409) 'ambiguous package cannot compare until explicitly selected'
    $invalidSelection = Invoke-SimHttp $session 'PUT' "/api/sim/technical-reviews/$ambiguousId/technical-package" @{documents=$ambiguousDocs;governingBomDocumentId='DOC-003'}
    Require ($invalidSelection.Status -eq 400) 'approval document cannot govern the parent BOM'
    $ambiguousDocs[1].role = 'GOVERNING'
    $null = Invoke-SimHttp $session 'PUT' "/api/sim/technical-reviews/$ambiguousId/technical-package" @{documents=$ambiguousDocs;governingBomDocumentId='DOC-002'}
    $selectedComparison = Invoke-SimHttp $session 'POST' "/api/sim/technical-reviews/$ambiguousId/materials-definition" $null
    Require ($selectedComparison.Body.record.technicalReview.materialsDefinition.result -eq 'DIFFERENCES_FOUND' -and $selectedComparison.Body.record.technicalReview.subassemblyCoverage[0].coverageState -eq 'UNRESOLVED') 'selected second BOM drives comparison and unresolved subassembly role does not imply coverage'
    $ambiguousDocs[3].role = 'REFERENCED'
    $editedPackage = Invoke-SimHttp $session 'PUT' "/api/sim/technical-reviews/$ambiguousId/technical-package" @{documents=$ambiguousDocs;governingBomDocumentId='DOC-002'}
    Require ($null -eq $editedPackage.Body.record.technicalReview.materialsDefinition -and $null -eq $editedPackage.Body.record.technicalReview.subassemblyCoverage) 'inventory edits invalidate stale comparison and coverage'
    $coveredComparison = Invoke-SimHttp $session 'POST' "/api/sim/technical-reviews/$ambiguousId/materials-definition" $null
    Require ($coveredComparison.Body.record.technicalReview.subassemblyCoverage[0].coverageState -eq 'COVERED' -and $coveredComparison.Body.record.technicalReview.subassemblyCoverage[0].customerDocumentIds[0] -eq 'DOC-004') 'classified referenced subassembly BOM accounts for otherwise missing coverage'
    $closedPackage = Invoke-SimHttp $session 'PUT' "/api/sim/technical-reviews/$differenceId/technical-package" @{documents=$diffDocs;governingBomDocumentId='DOC-001'}
    Require ($closedPackage.Status -eq 409) 'closed review package remains preserved and cannot be mutated'

    # One physical drawing can supply the governing BOM while retaining its drawing role.
    $embeddedDocs = @($packageDocs | ForEach-Object { $_.Clone() })
    $embeddedDocs[1].role = 'REFERENCED'
    $embeddedDocs[0].role = 'GOVERNING'
    $plainDrawing = Invoke-SimHttp $session 'PUT' "/api/sim/technical-reviews/$historyId/technical-package" @{documents=$embeddedDocs;governingBomDocumentId='DOC-001'}
    Require ($plainDrawing.Status -eq 400) 'drawing without embedded BOM cannot govern materials'
    $embeddedDocs[0].embeddedBom = $true
    $embeddedSaved = Invoke-SimHttp $session 'PUT' "/api/sim/technical-reviews/$historyId/technical-package" @{documents=$embeddedDocs;governingBomDocumentId='DOC-001'}
    $embeddedPackage = $embeddedSaved.Body.record.technicalReview.technicalPackage
    Require ($embeddedSaved.Status -eq 200 -and $embeddedPackage.documents.Count -eq 4 -and $embeddedPackage.documents[0].documentType -eq 'ASSEMBLY_DRAWING' -and $embeddedPackage.documents[0].embeddedBom -and $embeddedPackage.governingBomSourceKind -eq 'EMBEDDED_IN_ASSEMBLY_DRAWING') 'embedded selection preserves one drawing identity with explicit content capability and source kind'
    $embeddedMaterials = Invoke-SimHttp $session 'POST' "/api/sim/technical-reviews/$historyId/materials-definition" $null
    Require ($embeddedMaterials.Body.record.technicalReview.materialsDefinition.currentBom.sourceKind -eq 'EMBEDDED_IN_ASSEMBLY_DRAWING' -and $embeddedMaterials.Body.record.technicalReview.materialsDefinition.synthetic -and $embeddedMaterials.Body.record.technicalReview.materialsDefinition.result -eq 'LOOKS_CONSISTENT' -and $embeddedMaterials.Body.record.technicalReview.subassemblyCoverage[0].coverageState -eq 'COVERED') 'synthetic embedded comparison retains source marker and subassembly coverage'
    $embeddedDocs[2].embeddedBom = $true
    $invalidEmbedded = Invoke-SimHttp $session 'PUT' "/api/sim/technical-reviews/$historyId/technical-package" @{documents=$embeddedDocs;governingBomDocumentId='DOC-001'}
    Require ($invalidEmbedded.Status -eq 400) 'non-drawing document cannot claim embedded BOM capability'
    $embeddedDocs[2].Remove('embeddedBom')
    $embeddedDocs[1].role = 'GOVERNING'
    $standaloneAgain = Invoke-SimHttp $session 'PUT' "/api/sim/technical-reviews/$historyId/technical-package" @{documents=$embeddedDocs;governingBomDocumentId='DOC-002'}
    Require ($standaloneAgain.Body.record.technicalReview.technicalPackage.governingBomSourceKind -eq 'STANDALONE_BOM' -and $standaloneAgain.Body.record.technicalReview.technicalPackage.documents[0].role -eq 'GOVERNING') 'switching BOM source preserves governing drawing role and standalone behavior'
    $null = Invoke-SimHttp $session 'POST' "/api/sim/technical-reviews/$historyId/materials-definition" $null

    $binaryDraft = [guid]::NewGuid().ToString()
    $uploadUri = "$baseUri/api/sim/intake-drafts/$binaryDraft/documents?name=fixture.pdf"
    $pdfBytes = [Text.Encoding]::ASCII.GetBytes('%PDF-1.4 synthetic binary transfer fixture')
    $staged = Invoke-RestMethod $uploadUri -Method Post -Headers @{'X-SIM-Document-Upload'='1'} -ContentType application/octet-stream -Body $pdfBytes -WebSession $session
    Require ($staged.binaryStatus -eq 'VERIFIED' -and $staged.documentId -and $staged.type -eq 'application/pdf') 'binary upload verifies bytes and returns a safe stable document reference'
    $draftXls = [guid]::NewGuid().ToString()
    $xlsBytes = [byte[]]@(208,207,17,224,161,177,26,225,1,2,3)
    $xlsStage = Invoke-RestMethod "$baseUri/api/sim/intake-drafts/$draftXls/documents?name=transfer.xls" -Method Post -Headers @{'X-SIM-Document-Upload'='1'} -ContentType application/octet-stream -Body $xlsBytes -WebSession $session
    $removedDraft = Invoke-SimHttp $session 'DELETE' "/api/sim/intake-drafts/$draftXls/documents/$($xlsStage.documentId)" $null
    Require ($removedDraft.Status -eq 204 -and -not (Test-Path (Join-Path $repository ".sim-state/intake-documents/$draftXls/$($xlsStage.documentId).bin"))) 'removed draft attachment deletes only its governed binary copy'
    try { $null = Invoke-WebRequest "$baseUri/api/sim/intake-drafts/$draftXls/documents?name=..%2Foutside.pdf" -Method Post -Headers @{'X-SIM-Document-Upload'='1'} -Body $pdfBytes -WebSession $session; $pathRejected=$false } catch { $pathRejected=([int]$_.Exception.Response.StatusCode -eq 400) }
    Require $pathRejected 'path traversal in original filename is rejected'
    $binaryPayload = $payload.Clone(); $binaryPayload.requestCorrelationId=$binaryDraft; $binaryPayload.technicalFiles=@($staged)
    $binaryIntake = Invoke-SimHttp $session 'POST' '/api/sim/rfq-intakes' $binaryPayload
    $binaryId = $binaryIntake.Body.record.intakeId
    Require ($binaryIntake.Status -eq 201 -and $binaryIntake.Body.record.documentPreservationState -eq 'BINARIES_VERIFIED_SIM') 'intake submission persists server-verified attachment metadata'
    $openUri = "$baseUri/api/sim/rfq-intakes/$binaryId/documents/$($staged.documentId)"
    $opened = Invoke-WebRequest $openUri -WebSession $session
    Require ($opened.Headers['Content-Type'] -like '*application/pdf*' -and $opened.Headers['Content-Disposition'] -like '*inline*' -and $opened.RawContentLength -eq $pdfBytes.Length) 'governed PDF endpoint returns exact bytes inline with safe headers'
    $unknownDoc = Invoke-SimHttp $session 'GET' "/api/sim/rfq-intakes/$binaryId/documents/$([guid]::NewGuid())" $null
    Require ($unknownDoc.Status -eq 404) 'unknown document IDs are rejected'
    $wrongIntake = Invoke-SimHttp $session 'GET' "/api/sim/rfq-intakes/$historyId/documents/$($staged.documentId)" $null
    Require ($wrongIntake.Status -eq 404) 'document reference cannot be used under a different intake'
    $forgedPayload = $binaryPayload.Clone(); $forgedPayload.requestCorrelationId=[guid]::NewGuid().ToString()
    $forged = Invoke-SimHttp $session 'POST' '/api/sim/rfq-intakes' $forgedPayload
    Require ($forged.Status -eq 404) 'staged files cannot be claimed by a different intake correlation'
    $removeCommitted = Invoke-SimHttp $session 'DELETE' "/api/sim/intake-drafts/$binaryDraft/documents/$($staged.documentId)" $null
    Require ($removeCommitted.Status -eq 409) 'draft cleanup cannot delete a submitted attachment'
    $deniedSession = [Microsoft.PowerShell.Commands.WebRequestSession]::new()
    $null = Invoke-SimHttp $deniedSession 'POST' '/api/sim/persona' @{personaId='no-access'}
    $deniedDocument = Invoke-SimHttp $deniedSession 'GET' "/api/sim/rfq-intakes/$binaryId/documents/$($staged.documentId)" $null
    Require ($deniedDocument.Status -eq 403) 'opening documents requires Technical Review view permission'
    $tamperPath = Join-Path $repository ".sim-state/intake-documents/$binaryDraft/$($staged.documentId).bin"
    [IO.File]::WriteAllBytes($tamperPath, [byte[]]@(1,2,3))
    $tampered = Invoke-SimHttp $session 'GET' "/api/sim/rfq-intakes/$binaryId/documents/$($staged.documentId)" $null
    Require ($tampered.Status -eq 409) 'changed staged bytes fail hash verification rather than opening'
    [IO.File]::WriteAllBytes($tamperPath,$pdfBytes)

    $missingPayload = $payload.Clone()
    $missingPayload.requestCorrelationId = [guid]::NewGuid().ToString()
    $missingPayload.technicalFilesProvided = $false
    $missingPayload.technicalFiles = @()
    $missingFixture = Invoke-SimHttp $session 'POST' '/api/sim/rfq-intakes' $missingPayload
    $missingId = $missingFixture.Body.record.intakeId
    $null = Invoke-SimHttp $session 'PUT' "/api/sim/technical-reviews/$missingId/disposition" @{disposition='START_TECHNICAL_REVIEW'}
    $null = Invoke-SimHttp $session 'PUT' "/api/sim/technical-reviews/$missingId/assembly-classification" @{assemblyClassification='EXISTING_ASSEMBLY'}
    $missingMaterials = Invoke-SimHttp $session 'POST' "/api/sim/technical-reviews/$missingId/materials-definition" $null
    Require ($missingMaterials.Status -eq 409) 'missing customer BOM is incomplete, never a false match'
    $unbuiltPayload = $payload.Clone()
    $unbuiltPayload.requestCorrelationId = [guid]::NewGuid().ToString()
    $unbuiltPayload.assemblies = @(@{lineNumber=1;assemblyNumber='B11283-17';revision='C';quantity=25})
    $unbuilt = Invoke-SimHttp $session 'POST' '/api/sim/rfq-intakes' $unbuiltPayload
    $unbuiltId = $unbuilt.Body.record.intakeId
    $null = Invoke-SimHttp $session 'PUT' "/api/sim/technical-reviews/$unbuiltId/disposition" @{disposition='START_TECHNICAL_REVIEW'}
    $null = Invoke-SimHttp $session 'PUT' "/api/sim/technical-reviews/$unbuiltId/assembly-classification" @{assemblyClassification='EXISTING_ASSEMBLY'}
    $unbuiltMaterials = Invoke-SimHttp $session 'POST' "/api/sim/technical-reviews/$unbuiltId/materials-definition" $null
    Require ($unbuiltMaterials.Status -eq 409) 'existing assembly with an unbuilt requested revision cannot enter this comparison'
    $repeatHistory = Invoke-SimHttp $session 'POST' "/api/sim/technical-reviews/$historyId/assembly-history" $null
    Require ($repeatHistory.Body.record.technicalReview.assemblyHistory.confirmedAtUtc -eq $confirmed.Body.record.technicalReview.assemblyHistory.confirmedAtUtc -and $repeatHistory.Body.record.technicalReview.assemblyHistory.lookedUpAtUtc -eq $history.lookedUpAtUtc) 'reopen uses persisted lookup and decision without changing audit timestamps'
    $deniedHistory = Invoke-SimHttp $viewer 'POST' "/api/sim/technical-reviews/$historyId/assembly-history" $null
    Require ($deniedHistory.Status -eq 403) 'history writes require review disposition permission'
    $payload.requestCorrelationId = [guid]::NewGuid().ToString()
    $payload.assemblies = @(@{lineNumber=1;assemblyNumber='SIM-NEW-ASSEMBLY';revision='A';quantity=1})
    $newFixture = Invoke-SimHttp $session 'POST' '/api/sim/rfq-intakes' $payload
    $newId = $newFixture.Body.record.intakeId
    $null = Invoke-SimHttp $session 'PUT' "/api/sim/technical-reviews/$newId/disposition" @{ disposition = 'START_TECHNICAL_REVIEW' }
    $newHistory = Invoke-SimHttp $session 'POST' "/api/sim/technical-reviews/$newId/assembly-history" $null
    Require (-not $newHistory.Body.record.technicalReview.assemblyHistory.historyFound -and $newHistory.Body.record.technicalReview.assemblyHistory.records.Count -eq 0) 'unmatched assembly returns a completed no-history result'
    $newDecision = Invoke-SimHttp $session 'PUT' "/api/sim/technical-reviews/$newId/assembly-classification" @{ assemblyClassification = 'NEW_ASSEMBLY' }
    Require ($newDecision.Body.record.technicalReview.assemblyHistory.assemblyClassification -eq 'NEW_ASSEMBLY') 'New Assembly is persisted as structured review state'
    $newClosed = Invoke-SimHttp $session 'PUT' "/api/sim/technical-reviews/$newId/disposition" @{ disposition = 'NO_LONGER_REQUIRED' }
    Require ($newClosed.Body.record.technicalReview.assemblyHistory.assemblyClassification -eq 'NEW_ASSEMBLY') 'Save closure preserves the guided history result'
    $closedHistory = Invoke-SimHttp $session 'POST' "/api/sim/technical-reviews/$newId/assembly-history" $null
    Require ($closedHistory.Status -eq 409) 'history lookup cannot mutate a closed review'

    $missingGerbers = @{
        assemblyType = 'PCB_ASSEMBLY'; assemblyDrawingFile = 'B11283-17_Assembly_Drawing_Rev_B.pdf'; bomFile = 'B11283-17_BOM_Rev_B.xlsx'
        gerbersRequired = $true; gerberFiles = @(); subAssemblyDocuments = @(); materialResponsibility = 'FULL_TURNKEY'
        customerSuppliedItems = @(); technicalPackageSufficient = $true; disposition = 'QUALIFIED_READY_FOR_RFQ'; reviewerNotes = ''
    }
    $blocked = Invoke-SimHttp $session 'PUT' "/api/sim/technical-reviews/$intakeId/disposition" $missingGerbers
    Require ($blocked.Status -eq 400) 'missing required Gerbers prevent full-turnkey PCB qualification'

    $hybridWithoutBoundary = $missingGerbers.Clone()
    $hybridWithoutBoundary.materialResponsibility = 'HYBRID'
    $hybridWithoutBoundary.gerbersRequired = $false
    $hybridWithoutBoundary.disposition = 'NEEDS_CUSTOMER_CLARIFICATION'
    $boundaryRequired = Invoke-SimHttp $session 'PUT' "/api/sim/technical-reviews/$intakeId/disposition" $hybridWithoutBoundary
    Require ($boundaryRequired.Status -eq 400) 'hybrid review requires an explicit customer-supplied responsibility boundary'

    $hybridQualified = $hybridWithoutBoundary.Clone()
    $hybridQualified.customerSuppliedItems = @('Customer supplies programmed controller U14')
    $hybridQualified.technicalPackageSufficient = $true
    $hybridQualified.disposition = 'QUALIFIED_READY_FOR_RFQ'
    $hybridSaved = Invoke-SimHttp $session 'PUT' "/api/sim/technical-reviews/$intakeId/disposition" $hybridQualified
    Require ($hybridSaved.Status -eq 200 -and $hybridSaved.Body.record.technicalReview.materialResponsibility -eq 'HYBRID' -and $hybridSaved.Body.record.technicalReview.customerSuppliedItems[0] -like '*U14') 'hybrid qualification persists the customer-supplied responsibility boundary'

    $qualified = $missingGerbers.Clone()
    $qualified.gerberFiles = @('B11283-17_Gerbers_Rev_B.zip')
    $qualified.subAssemblyDocuments = @('B11283-17_Subassembly_Spec.pdf')
    $qualified.reviewerNotes = 'Assembly drawing, BOM, and required Gerbers identified from source package metadata.'
    $saved = Invoke-SimHttp $session 'PUT' "/api/sim/technical-reviews/$intakeId/disposition" $qualified
    Require ($saved.Status -eq 200 -and $saved.Body.record.status -eq 'READY_FOR_RFQ_WORKING_QUEUE') 'qualified review persists the future RFQs working-queue state'
    Require ($saved.Body.record.technicalReview.assemblyType -eq 'PCB_ASSEMBLY' -and $saved.Body.record.technicalReview.assemblyDrawingFile -like '*Assembly_Drawing*' -and $saved.Body.record.technicalReview.bomFile -like '*BOM*') 'PCB type and governing Drawing/BOM persist'
    Require ($saved.Body.record.technicalReview.gerberFiles[0] -like '*Gerbers*' -and $saved.Body.record.technicalReview.subAssemblyDocuments[0] -like '*Subassembly*') 'Gerber and sub-assembly document associations persist'
    Require ($saved.Body.record.technicalReview.downstreamHandoffTarget -eq 'RFQs' -and $saved.Body.record.technicalReview.downstreamHandoffState -eq 'READY_FOR_RFQ_WORKING_QUEUE') 'successful review records only the future RFQs handoff'
    $readBack = Invoke-SimHttp $session 'GET' "/api/sim/technical-reviews/$intakeId" $null
    Require ($readBack.Status -eq 200 -and $readBack.Body.record.status -eq 'READY_FOR_RFQ_WORKING_QUEUE') 'persisted disposition reads back in the qualified RFQ handoff state'
    $queue = Invoke-SimHttp $session 'GET' '/api/sim/technical-reviews' $null
    Require (@($queue.Body.items | Where-Object intakeId -EQ $intakeId).Count -eq 0) 'completed RFQ handoff is excluded from the active review queue'
    $qualifiedDetail = Invoke-SimHttp $session 'GET' "/api/sim/technical-reviews/$intakeId" $null
    Require ($qualifiedDetail.Body.deletionEligibility.allowed) 'basic qualification with only the known future RFQ placeholder remains early-stage'
    $deletedQualified = Invoke-SimHttp $session 'DELETE' "/api/sim/technical-reviews/$intakeId" $null
    Require ($deletedQualified.Status -eq 200) 'qualification selections without an independent downstream artifact do not block Delete'

    . (Join-Path $PSScriptRoot 'candidate-checks.ps1')

    Stop-Process -Id $hostProcess.Id -Force
    $hostProcess.WaitForExit()
    $env:DLE_OS_SIM_PORT = [string]$testPort
    $hostProcess = Start-Process dotnet -ArgumentList @($dll) -WorkingDirectory $repository `
        -RedirectStandardOutput $stdout -RedirectStandardError $stderr -PassThru -WindowStyle Hidden
    Remove-Item Env:DLE_OS_SIM_PORT -ErrorAction SilentlyContinue
    $ready = $false
    for ($attempt = 0; $attempt -lt 50; $attempt++) {
        try { if ((Invoke-RestMethod "$baseUri/api/sim/status" -TimeoutSec 1).status -eq 'READY') { $ready = $true; break } }
        catch { Start-Sleep -Milliseconds 100 }
    }
    Require $ready 'SIM restarts with persisted review dataset'
    $candidateRestart = Invoke-SimHttp $session 'GET' "/api/sim/technical-reviews/$candidateId" $null
    Require ($candidateRestart.Body.record.technicalReview.candidateBom.rows[0].values.partNumber -eq 'HUMAN-CORRECTION') 'candidate corrections survive process restart'
    Require ($candidateRestart.Body.record.technicalReview.candidateBom.rows[0].alternates[0].partNumber -eq 'SYNTHETIC-ALT-CORRECTED' -and $candidateRestart.Body.record.technicalReview.candidateBom.rows[0].alternates[0].history.Count -eq 2) 'alternate values and history survive full host process restart'
    Require ($candidateRestart.Body.record.technicalReview.candidateBom.rows[0].componentType -eq 'SUBASSEMBLY' -and @($candidateRestart.Body.record.technicalReview.candidateBom.rows[0].corrections | Where-Object field -eq 'componentType').Count -eq 1) 'component classification and audit survive full host restart'
    Require ($candidateRestart.Body.record.technicalReview.bomAcceptances[0].candidate.id -eq $candidate.id -and $candidateRestart.Body.record.technicalReview.materialsReviewStatus -eq 'QUALIFIED' -and $candidateRestart.Body.record.technicalReview.nextReviewPhase -eq 'MANUFACTURING_LABOR_REVIEW') 'accepted BOM and materials-only completion survive Save closure and full host restart'
    $candidateDeleted = Invoke-SimHttp $session 'DELETE' "/api/sim/technical-reviews/$candidateId" $null
    Require ($candidateDeleted.Status -eq 200) 'candidate-only state remains early-stage deletable for isolated fixture cleanup'
    $deletedAfterRestart = Invoke-SimHttp $session 'GET' "/api/sim/rfq-intakes/$deleteId" $null
    $savedAfterRestart = Invoke-SimHttp $session 'GET' "/api/sim/technical-reviews/$closeId" $null
    Require ($deletedAfterRestart.Status -eq 404) 'deleted legacy intake does not resurrect after restart'
    Require ($savedAfterRestart.Body.record.status -eq 'NO_LONGER_REQUIRED') 'Save remains preserved and readable after restart'
    $historyAfterRestart = Invoke-SimHttp $session 'GET' "/api/sim/technical-reviews/$historyId" $null
    $newAfterRestart = Invoke-SimHttp $session 'GET' "/api/sim/technical-reviews/$newId" $null
    Require ($historyAfterRestart.Body.record.technicalReview.assemblyHistory.assemblyClassification -eq 'EXISTING_ASSEMBLY' -and $newAfterRestart.Body.record.technicalReview.assemblyHistory.assemblyClassification -eq 'NEW_ASSEMBLY') 'both guided decisions survive host restart'
    Require ($historyAfterRestart.Body.record.technicalReview.technicalPackage.governingBomDocumentId -eq 'DOC-002' -and $historyAfterRestart.Body.record.technicalReview.subassemblyCoverage[0].customerDocumentIds[0] -eq 'DOC-004') 'package classification selection and coverage survive restart'
    Require ($historyAfterRestart.Body.record.technicalReview.technicalPackage.documents[0].embeddedBom -and $historyAfterRestart.Body.record.technicalReview.technicalPackage.governingBomSourceKind -eq 'STANDALONE_BOM') 'embedded capability and selected source kind survive restart'
    $binaryRestart = Invoke-WebRequest $openUri -WebSession $session
    Require ($binaryRestart.StatusCode -eq 200 -and $binaryRestart.RawContentLength -eq $pdfBytes.Length) 'staged binaries and committed references survive host restart'
    $binaryDeleted = Invoke-SimHttp $session 'DELETE' "/api/sim/technical-reviews/$binaryId" $null
    Require ($binaryDeleted.Status -eq 200 -and -not (Test-Path $tamperPath)) 'early-stage Delete removes owned staged binary after verifying ownership'
    $differenceAfterRestart = Invoke-SimHttp $session 'GET' "/api/sim/technical-reviews/$differenceId" $null
    Require ($historyAfterRestart.Body.record.technicalReview.materialsDefinition.result -eq 'LOOKS_CONSISTENT' -and $differenceAfterRestart.Body.record.technicalReview.materialsDefinition.result -eq 'DIFFERENCES_FOUND') 'materials snapshots survive host restart'
}
finally {
    Remove-Item Env:DLE_OS_SIM_PORT -ErrorAction SilentlyContinue
    if ($null -ne $hostProcess -and -not $hostProcess.HasExited) { Stop-Process -Id $hostProcess.Id -Force; $hostProcess.WaitForExit() }
    if ($datasetExisted) { Copy-Item -LiteralPath $datasetBackup -Destination $datasetPath -Force }
    elseif (Test-Path $datasetPath) { Remove-Item -LiteralPath $datasetPath -Force }
    if ($null -ne $savedRuntimeMetadata) { [IO.File]::WriteAllText($runtimeMetadataPath, $savedRuntimeMetadata) }
}

Write-Host "PASS: $($checks.Count) DLE-OS SIM Technical Review checks."
$checks | ForEach-Object { Write-Host "  - $_" }
