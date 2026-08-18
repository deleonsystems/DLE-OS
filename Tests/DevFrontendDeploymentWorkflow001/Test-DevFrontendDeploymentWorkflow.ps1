[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$repository = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')).Path
$commonPath = Join-Path $repository 'Tools\DevelopmentRuntime\DevFrontendDeployment.Common.ps1'
$launcherPath = Join-Path $repository 'Tools\DevelopmentRuntime\Deploy-DevFrontend.ps1'
$enginePath = Join-Path $repository 'Tools\DevelopmentRuntime\Deploy-DleOsDevelopmentFrontendWindowsService.ps1'
$commandPath = Join-Path $repository 'Deploy-DevFrontend.cmd'
$configurationPath = Join-Path $repository 'Tools\DevelopmentRuntime\DleOs.DevelopmentFrontend\service-runtime.Development.json'

. $commonPath
$checks = [Collections.Generic.List[string]]::new()
function Check([bool]$condition,[string]$name){if(-not$condition){throw "FAILED: $name"};$checks.Add($name)}

foreach($path in $commonPath,$launcherPath,$enginePath){
    $tokens=$null;$errors=$null
    [void][Management.Automation.Language.Parser]::ParseFile($path,[ref]$tokens,[ref]$errors)
    Check ($errors.Count-eq 0) "$(Split-Path $path -Leaf) parses"
}
Check (Test-Path -LiteralPath $commandPath) 'repository-root official command exists'
$commandSource=Get-Content -LiteralPath $commandPath -Raw
$launcherSource=Get-Content -LiteralPath $launcherPath -Raw
$engineSource=Get-Content -LiteralPath $enginePath -Raw
Check ($commandSource.Contains('-ExecutionPolicy Bypass')-and$commandSource.Contains('Deploy-DevFrontend.ps1')) 'official command hides PowerShell invocation details'
Check ($launcherSource.Contains('-Verb RunAs')-and$launcherSource.Contains('-Confirm:`$false')-and$launcherSource.Contains('.WaitForExit(1800000)')) 'launcher owns one bounded synchronous elevation boundary'
Check ((Get-DleOsNormalizedAccountName '.\DLE-OS-DEV-FRONTEND' 'DLE-OS-HOST')-eq'DLE-OS-HOST\DLE-OS-DEV-FRONTEND') 'local service account alias normalizes'
Check ((Get-DleOsNormalizedAccountName 'DLE-OS-HOST\DLE-OS-DEV-FRONTEND' 'DLE-OS-HOST')-eq'DLE-OS-HOST\DLE-OS-DEV-FRONTEND') 'qualified service account remains stable'
$forms=@(Get-DleOsHttpPrefixDisplayForms 'http://192.168.0.105:5051/')
Check ($forms-contains'HTTP://192.168.0.105:5051/'-and$forms-contains'HTTP://192.168.0.105:5051:192.168.0.105/') 'HTTP.sys IP-bound display form normalizes'
Check (@(Get-DleOsHttpPrefixDisplayForms 'https://dev.dle-os.internal.dlemfg.com:443/').Count-eq1) 'hostname prefix remains exact'
$config=Assert-DleOsDevelopmentFrontendConfiguration $configurationPath
Check ($config.environment-eq'Development') 'approved DEV target passes guard'
$rejected=$false
$temporary=$null
try{
    $temporary=Join-Path ([IO.Path]::GetTempPath()) ('dle-os-nondev-'+[guid]::NewGuid()+'.json')
    '{"environment":"Production"}'|Set-Content -LiteralPath $temporary
    $null=Assert-DleOsDevelopmentFrontendConfiguration $temporary
}catch{$rejected=$true}finally{if($temporary){Remove-Item -LiteralPath $temporary -ErrorAction SilentlyContinue}}
Check $rejected 'non-DEV configuration fails closed'
Check ($engineSource.Contains('$evidence.ReleasePath=$release')-and$engineSource.Contains('$evidence.Verdict=''PASS''')) 'engine records release and PASS evidence'
Check ($engineSource.Contains('$evidence.RollbackAttempted=$true')-and$engineSource.Contains('$evidence.PreviousReleaseRestored=$true')-and$engineSource.Contains('$evidence.ProtectedRollbackVerified=$true')) 'candidate failure retains rollback evidence contract'
Check ($engineSource.Contains('$actualServiceSid-ne$expectedServiceSid')) 'engine compares service identity by SID'
Check ($engineSource.Contains('$service.ProcessId-notin$registration.ProcessIds')) 'exact HTTP.sys PID ownership validation remains'

Write-Output "PASS: $($checks.Count) DEV frontend deployment workflow checks."
$checks|ForEach-Object{Write-Output "  $_"}
