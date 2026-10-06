$ErrorActionPreference='Stop'
$tokens=$null; $errors=$null
$ast=[Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot '../../Tools/SimRuntime/DesktopControls/Start-DleOsSimServer.ps1'),[ref]$tokens,[ref]$errors)
if($errors.Count){throw $errors[0]}
$fn=$ast.Find({param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq 'Test-AuthenticatedReady'},$true)
$protect=$ast.Find({param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq 'Protect-ErrorText'},$true)
Invoke-Expression $protect.Extent.Text
Invoke-Expression $fn.Extent.Text
$usesUserConfiguredCode=$true; $configuredAccessCode='isolated-test'; $profile=@{url='https://fixture.invalid'}
$script:calls=0
function Invoke-WebRequest {param($Uri,$Method,$Body,$WebSession,$TimeoutSec) $script:calls++; if($script:calls -lt 3){throw 'simulated transient connection failure'}; if($TimeoutSec -ne 5){throw 'incorrect timeout'} }
function Invoke-RestMethod {param($Uri,$WebSession,$TimeoutSec) return @{status='READY';environment='SIM';networkBoundary='PRIVATE_LAN_HTTPS';binding='https://fixture.invalid'} }
function Start-Sleep {param($Milliseconds)}
if(-not(Test-AuthenticatedReady -Attempts 3) -or $script:calls -ne 3){throw 'Retry failed'}
Write-Output 'PASS: readiness recovers after two transient failures'
$usesUserConfiguredCode=$false
if(Test-AuthenticatedReady){throw 'Readiness allowed missing authentication'}
Write-Output 'PASS: missing authentication remains fail-closed'


