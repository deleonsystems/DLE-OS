[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$repository=(Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')).Path
$root=Join-Path $repository ('.tmp\two-machine-static-test\'+[Guid]::NewGuid().ToString('N'))
$request=& (Join-Path $repository 'Tools\DevelopmentRuntime\New-DleOsDevelopmentFrontendFileServerBootstrapRequest.ps1') -OutputRoot $root
$responseDirectory=Join-Path $root 'response'
$serverExecutable=Join-Path $root 'DleOsLegacyFileServerBootstrap.Simulation.exe'
$compiler=Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if(-not(Test-Path -LiteralPath $compiler)){ $compiler=Join-Path $env:WINDIR 'Microsoft.NET\Framework\v4.0.30319\csc.exe' }
& $compiler /nologo /target:exe /platform:anycpu /optimize+ "/out:$serverExecutable" `
    /reference:System.dll /reference:System.Core.dll /reference:System.Security.dll `
    /reference:System.DirectoryServices.dll /reference:System.Management.dll /reference:System.Web.Extensions.dll `
    (Join-Path $request.ServerPackageDirectory 'DleOsLegacyFileServerBootstrap.cs')
if($LASTEXITCODE-ne 0){throw "Legacy simulation compile failed with exit code $LASTEXITCODE."}
$serverRequest=Join-Path $request.ServerPackageDirectory 'bootstrap-request.json'
if(Test-Path (Join-Path $request.ServerPackageDirectory 'host-private-handoff.dpapi')){throw 'The portable server package contains host-private key material.'}
& $serverExecutable simulate $serverRequest $responseDirectory | Out-Null
if($LASTEXITCODE-ne 0){throw "Legacy server simulation failed with exit code $LASTEXITCODE."}
$dummy=ConvertTo-SecureString 'simulation-only-not-persisted' -AsPlainText -Force
$credential=[Management.Automation.PSCredential]::new('DLE-OS-HOST\DLE-OS',$dummy)
$validation=& (Join-Path $repository 'Tools\DevelopmentRuntime\Invoke-DleOsDevelopmentFrontendServiceMigration.ps1') -ApproveMigration -BootstrapRequestDirectory $request.Directory -BootstrapResponseDirectory $responseDirectory -SqlAdministratorCredential $credential -ValidateBootstrapOnly -AllowSimulationEvidence -Confirm:$false
if($request.Verdict-ne'PASS'-or$validation.Verdict-ne'PASS'-or-not$validation.ValidationOnly-or-not$validation.BootstrapSignatureValidated-or$request.TransactionId-ne$validation.BootstrapTransactionId){throw 'The encrypted two-machine handoff simulation failed.'}
if(Test-Path (Join-Path $responseDirectory 'fileserver-rollback-state.dpapi')){throw 'Simulation must not create a machine rollback state.'}
$response=Get-Content -Raw (Join-Path $responseDirectory 'bootstrap-response.json')
if($response-match'(?i)plaintextPassword\s*"?\s*:\s*"[^f]'){throw 'Simulation response appears to persist a plaintext password.'}

# Preserve the response checksum while changing the signed payload. Host validation
# must still fail because the DELEON-SERVER HMAC cannot be forged without the password.
. (Join-Path $repository 'Tools\DevelopmentRuntime\DleOsDevelopmentFrontendBootstrapCrypto.ps1')
$tamperedDirectory=Join-Path $root 'tampered-response'
Copy-Item -Path $responseDirectory -Destination $tamperedDirectory -Recurse
$tamperedPath=Join-Path $tamperedDirectory 'bootstrap-response.json'
$tampered=Get-Content -Raw $tamperedPath|ConvertFrom-Json
$payloadBytes=[Convert]::FromBase64String([string]$tampered.PayloadBase64)
$payload=[Text.Encoding]::UTF8.GetString($payloadBytes)|ConvertFrom-Json
$payload.ShareAccess='Full'
[Array]::Clear($payloadBytes,0,$payloadBytes.Length)
$payloadBytes=[Text.Encoding]::UTF8.GetBytes(($payload|ConvertTo-Json -Depth 8 -Compress))
try{$tampered.PayloadBase64=[Convert]::ToBase64String($payloadBytes);$tampered.PayloadSha256=Get-DleOsSha256Hex $payloadBytes}finally{[Array]::Clear($payloadBytes,0,$payloadBytes.Length)}
Write-DleOsUtf8File $tamperedPath ($tampered|ConvertTo-Json -Depth 10)
Write-DleOsUtf8File (Join-Path $tamperedDirectory 'bootstrap-response.sha256') ((Get-DleOsFileSha256 $tamperedPath)+"`n")
$tamperRejected=$false
try{
    & (Join-Path $repository 'Tools\DevelopmentRuntime\Invoke-DleOsDevelopmentFrontendServiceMigration.ps1') -ApproveMigration -BootstrapRequestDirectory $request.Directory -BootstrapResponseDirectory $tamperedDirectory -SqlAdministratorCredential $credential -ValidateBootstrapOnly -AllowSimulationEvidence -Confirm:$false|Out-Null
}catch{
    if($_.Exception.Message-match'Bootstrap evidence signature mismatch'){$tamperRejected=$true}else{throw}
}
if(-not$tamperRejected){throw 'A response with a recomputed checksum but invalid HMAC was accepted.'}
Write-Output "PASS: legacy RSA-CSP/DPAPI request, encrypted response, SHA-256, HMAC, tamper rejection, and host validation completed without infrastructure mutation."
