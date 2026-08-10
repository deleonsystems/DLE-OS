[CmdletBinding()]
param(
    [string]$BootstrapRequestDirectory,

    [string]$BootstrapResponseDirectory,

    [switch]$DiscoverOnly
)

Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$migration=Join-Path $PSScriptRoot 'Invoke-DleOsDevelopmentFrontendServiceMigration.ps1'
$repository=(Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')).Path
$canonicalStateRoot=Join-Path $repository '.tmp'
$bootstrapRoot=Join-Path $canonicalStateRoot 'development-frontend-two-machine-bootstrap'
$sqlIdentity='DLE-OS-HOST\DLE-OS'
$sqlCredential=$null
$validationCredential=$null
$validationSecret=$null
$pauseOnExit=-not$DiscoverOnly
$selected=$null
function Find-EligibleBootstrapTransaction{
    if(-not(Test-Path -LiteralPath $bootstrapRoot -PathType Container)){throw "Bootstrap root is absent: $bootstrapRoot"}
    $eligible=[Collections.Generic.List[object]]::new();$rejected=[Collections.Generic.List[string]]::new()
    foreach($directory in @(Get-ChildItem -LiteralPath $bootstrapRoot -Directory|Sort-Object Name)){
        $requestDirectory=Join-Path $directory.FullName 'host-state';$responseDirectory=Join-Path $directory.FullName 'response'
        $required=@(Join-Path $requestDirectory 'bootstrap-request.json';Join-Path $requestDirectory 'bootstrap-request.sha256';Join-Path $requestDirectory 'host-private-handoff.dpapi';Join-Path $responseDirectory 'bootstrap-response.json';Join-Path $responseDirectory 'bootstrap-response.sha256')
        $missing=@($required|Where-Object{-not(Test-Path -LiteralPath $_ -PathType Leaf)})
        if($missing.Count-ne 0){$rejected.Add("$($directory.Name): incomplete ($($missing.Count) files missing)");continue}
        try{
            $validation=&$migration -ApproveMigration -BootstrapRequestDirectory $requestDirectory -BootstrapResponseDirectory $responseDirectory -SqlAdministratorCredential $validationCredential -ValidateBootstrapOnly -Confirm:$false
            if($validation.Verdict-cne'PASS'-or-not$validation.BootstrapSignatureValidated){throw 'cryptographic validation did not return PASS'}
            $request=Get-Content -Raw (Join-Path $requestDirectory 'bootstrap-request.json')|ConvertFrom-Json
            $eligible.Add([pscustomobject]@{TransactionId=[string]$request.TransactionId;RequestDirectory=$requestDirectory;ResponseDirectory=$responseDirectory})
        }catch{$rejected.Add("$($directory.Name): $($_.Exception.Message)")}
    }
    if($eligible.Count-ne 1){throw "Expected exactly one eligible canonical bootstrap transaction; found $($eligible.Count). Rejected: $($rejected-join' | ')"}
    $eligible[0]
}
try{
    $suppliedRequest=-not[string]::IsNullOrWhiteSpace($BootstrapRequestDirectory);$suppliedResponse=-not[string]::IsNullOrWhiteSpace($BootstrapResponseDirectory)
    if($suppliedRequest-xor$suppliedResponse){throw 'Request and response directories must either both be omitted or both be supplied.'}
    $validationSecret=ConvertTo-SecureString ([Guid]::NewGuid().ToString('N')) -AsPlainText -Force;$validationCredential=[Management.Automation.PSCredential]::new('VALIDATION-ONLY',$validationSecret)
    if(-not$suppliedRequest){$selected=Find-EligibleBootstrapTransaction;$BootstrapRequestDirectory=$selected.RequestDirectory;$BootstrapResponseDirectory=$selected.ResponseDirectory;Write-Host "Auto-selected validated bootstrap transaction $($selected.TransactionId)." -ForegroundColor Green}
    else{
        $prefix=(Resolve-Path -LiteralPath $canonicalStateRoot).Path.TrimEnd('\')+'\';foreach($path in $BootstrapRequestDirectory,$BootstrapResponseDirectory){$resolved=(Resolve-Path -LiteralPath $path).Path;if(-not$resolved.StartsWith($prefix,[StringComparison]::OrdinalIgnoreCase)){throw "Explicit transaction directory is outside canonical root $canonicalStateRoot."}}
    }
    if($DiscoverOnly){$transactionId=if($selected){$selected.TransactionId}else{[string](Get-Content -Raw (Join-Path $BootstrapRequestDirectory 'bootstrap-request.json')|ConvertFrom-Json).TransactionId};return [pscustomobject]@{Verdict='PASS';TransactionId=$transactionId;BootstrapRequestDirectory=$BootstrapRequestDirectory;BootstrapResponseDirectory=$BootstrapResponseDirectory;CanonicalStateRoot=$canonicalStateRoot}}
    Write-Host 'This local DLE-OS-HOST transaction uses the already-validated DELEON-SERVER evidence.' -ForegroundColor Cyan
    Write-Host 'The only prompt is for DLE-OS-HOST\DLE-OS: local SQL bootstrap and detached-runtime rollback only.' -ForegroundColor Yellow
    $sqlCredential=Get-Credential -UserName $sqlIdentity -Message 'DLE-OS-HOST credential for local DEV SQL bootstrap and exact detached-runtime rollback. It is not stored.'
    if($null-eq$sqlCredential-or$sqlCredential.UserName-ine$sqlIdentity){throw "The credential must be exactly $sqlIdentity."}
    & $migration -ApproveMigration -BootstrapRequestDirectory $BootstrapRequestDirectory `
        -BootstrapResponseDirectory $BootstrapResponseDirectory `
        -SqlAdministratorCredential $sqlCredential -Confirm:$false
    if(-not$?){throw 'The DEV Windows Service migration returned a failure status.'}
    Write-Host 'DEV Windows Service migration completed. Stop here before LIVE or Git publication.' -ForegroundColor Green
}catch{
    Write-Host $_.Exception.Message -ForegroundColor Red
    Write-Host 'No retry was attempted. If host mutation began, the exact detached runtime rollback was attempted.' -ForegroundColor Yellow
    throw
}finally{
    $sqlCredential=$null
    if($validationSecret){$validationSecret.Dispose()};$validationCredential=$null
    if($pauseOnExit){[void](Read-Host 'Press Enter to close this governed transaction window')}
}
