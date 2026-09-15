# Runs only inside the existing isolated Technical Review host qualification.
function Add-ReviewTestDocument($UserSession, $Id, $Name, $Type, $Scope, $Part, $Proposed, $Bytes, $Header = $true, $RowTarget = $null) {
    $boundary = 'sim-test-' + [guid]::NewGuid().ToString('N')
    $metadata = @{type=$Type; applicability=$Scope; subassemblyPartNumber=$Part; proposedSubassemblyIdentity=$Proposed; note='Synthetic qualification';rowTarget=$RowTarget} | ConvertTo-Json -Compress
    $prefix = "--$boundary`r`nContent-Disposition: form-data; name=`"metadata`"`r`n`r`n$metadata`r`n--$boundary`r`nContent-Disposition: form-data; name=`"file`"; filename=`"$Name`"`r`nContent-Type: application/octet-stream`r`n`r`n"
    [byte[]]$body = [Text.Encoding]::UTF8.GetBytes($prefix) + [byte[]]$Bytes + [Text.Encoding]::UTF8.GetBytes("`r`n--$boundary--`r`n")
    $null=$UserSession.Headers.Remove('X-SIM-Document-Upload')
    $headers = @{}; if($Header){$headers['X-SIM-Document-Upload']='1'}
    try { $response=Invoke-WebRequest "$baseUri/api/sim/technical-reviews/$Id/documents" -Method Post -WebSession $UserSession -Headers $headers -ContentType "multipart/form-data; boundary=$boundary" -Body $body; return @{Status=[int]$response.StatusCode;Body=($response.Content|ConvertFrom-Json)} }
    catch { return @{Status=[int]$_.Exception.Response.StatusCode} }
}
$null=Invoke-SimHttp $session 'PUT' "/api/sim/technical-reviews/$binaryId/disposition" @{disposition='START_TECHNICAL_REVIEW'}
$reviewBefore=(Invoke-SimHttp $session 'GET' "/api/sim/technical-reviews/$binaryId" $null).Body.record
$reviewAdded=Add-ReviewTestDocument $session $binaryId 'review-synthetic.pdf' 'DRAWING' 'PARENT_ASSEMBLY' '' '' $pdfBytes
Require ($reviewAdded.Status -eq 200) 'Technical Review multipart endpoint stages a classified PDF'
$reviewPdf=$reviewAdded.Body.record.technicalFiles[-1]
Require ($reviewPdf.reviewOrigin.sourceStage -eq 'Technical Review' -and $reviewPdf.reviewOrigin.sha256.Length -eq 64 -and $reviewPdf.reviewOrigin.originalFilename -eq 'review-synthetic.pdf' -and $reviewPdf.initialIdentification -eq $null) 'review upload has trusted provenance and does not become Intake history'
$reviewPdfUri="$baseUri/api/sim/rfq-intakes/$binaryId/documents/$($reviewPdf.documentId)"
$reviewPdfOpen=Invoke-WebRequest $reviewPdfUri -WebSession $session
Require ($reviewPdfOpen.RawContentLength -eq $pdfBytes.Length -and $reviewPdfOpen.Headers['Content-Disposition'] -like '*inline*') 'review-added PDF opens inline through the existing governed endpoint'
$gerberBytes=[Text.Encoding]::ASCII.GetBytes('G04 SYNTHETIC GERBER* M02*')
$reviewAdded=Add-ReviewTestDocument $session $binaryId 'review-top.gbr' 'GERBER_FILES' 'PARENT_ASSEMBLY' '' '' $gerberBytes
Require ($reviewAdded.Status -eq 200 -and $reviewAdded.Body.record.technicalFiles.Count -eq $reviewBefore.technicalFiles.Count+2) 'package Gerber upload is additive'
$reviewGerber=$reviewAdded.Body.record.technicalFiles[-1]
$reviewGerberDoc=$reviewAdded.Body.record.technicalReview.technicalPackage.documents[-1]
Require ($reviewGerberDoc.documentType -eq 'GERBER' -and $reviewGerberDoc.applicability -eq 'PARENT_ASSEMBLY' -and $reviewGerberDoc.rowAssociation -eq $null -and $reviewGerberDoc.identityReview.decision -eq 'CONFIRMED') 'package Gerber classification remains confirmed without row context'
$gerberOpen=Invoke-WebRequest "$baseUri/api/sim/rfq-intakes/$binaryId/documents/$($reviewGerber.documentId)" -WebSession $session
Require ($gerberOpen.RawContentLength -eq $gerberBytes.Length -and $gerberOpen.Headers['Content-Disposition'] -like '*attachment*') 'Gerber retrieved as a controlled attachment without parsing'
Require (($reviewAdded.Body.record.technicalFiles[0]|ConvertTo-Json -Depth 30) -eq ($reviewBefore.technicalFiles[0]|ConvertTo-Json -Depth 30)) 'review upload preserves existing Intake binary and classification'
Require ((Add-ReviewTestDocument $session $binaryId 'invalid.gbr' 'GERBER_FILES' 'SUBASSEMBLY' '' '' $gerberBytes).Status -eq 400) 'subassembly upload requires customer/BOM P/N'
Require ((Add-ReviewTestDocument $session $binaryId 'invalid.gbr' 'GERBER_FILES' 'SUBASSEMBLY' 'TEST' '' $gerberBytes $false).Status -eq 400) 'upload requires the existing explicit upload header'
Require ((Add-ReviewTestDocument $deniedSession $binaryId 'denied.gbr' 'GERBER_FILES' 'SUBASSEMBLY' 'TEST' '' $gerberBytes).Status -eq 403) 'upload requires Technical Review write permission'
Require ((Add-ReviewTestDocument $session $closeId 'closed.gbr' 'GERBER_FILES' 'SUBASSEMBLY' 'TEST' '' $gerberBytes).Status -eq 409) 'closed review rejects attachment'
