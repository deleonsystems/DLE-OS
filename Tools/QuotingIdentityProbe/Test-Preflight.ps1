# Pure function tests only. Never invoke the launcher, sockets, netsh or SCM.
$ErrorActionPreference='Stop'
$tokens=$null;$errors=$null
$ast=[Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot 'Invoke-ApprovedProbe.ps1'),[ref]$tokens,[ref]$errors)
if($errors.Count){throw ($errors.Message -join '; ')}
foreach($name in @('ConvertFrom-UrlResult','Assert-PortOutcome','Start-OneShotCaller','Assert-CallerReceipt')){
 $fn=$ast.FindAll({param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst]},$false)|Where-Object Name -eq $name
 if(@($fn).Count -ne 1){throw "Missing unique pure function: $name"}
 . ([scriptblock]::Create($fn.Extent.Text))
}
$prefix='http://127.0.0.1:51328/quoting-identity-probe/'
$empty="`r`nURL Reservations: `r`n----------------- `r`n`r`n"
$occupied="URL Reservations:`n-----------------`n    Reserved URL : $prefix`n        User: HOST\user`n        Listen: Yes`n        Delegate: No`n        SDDL: D:(A;;GX;;;SY)`n"
$passed=0
function Check([bool]$Value,[string]$Name){if(!$Value){throw "Failed: $Name"};$script:passed++}
function Reject([scriptblock]$Action,[string]$Name){$rejected=$false;try{& $Action|Out-Null}catch{$rejected=$true};Check $rejected $Name}
Check (!(ConvertFrom-UrlResult 0 $empty '' $prefix).Exists) 'observed successful empty listing'
Check ((ConvertFrom-UrlResult 0 $occupied '' $prefix).Exists) 'exact occupied reservation'
Reject {ConvertFrom-UrlResult 5 $empty '' $prefix} 'denied exit with empty-looking output'
Reject {ConvertFrom-UrlResult 0 $empty 'Access is denied' $prefix} 'stderr prevents absence'
Reject {ConvertFrom-UrlResult 1 ($empty+'The handle is invalid.') '' $prefix} 'observed sandbox invalid-handle failure'
Reject {ConvertFrom-UrlResult 0 '' '' $prefix} 'blank is not absence'
Reject {ConvertFrom-UrlResult 0 'unrecognized' '' $prefix} 'malformed output'
Reject {ConvertFrom-UrlResult 0 ($occupied.Replace('51328','51329')) '' $prefix} 'other prefix'
Reject {ConvertFrom-UrlResult 0 ($occupied+$occupied) '' $prefix} 'multiple entries'
Reject {ConvertFrom-UrlResult 0 ($empty+'Access is denied') '' $prefix} 'unexpected trailing content'
Reject {ConvertFrom-UrlResult 0 ($occupied+'Access is denied') '' $prefix} 'unexpected content after entry'
Assert-PortOutcome $false 'ConnectionRefused';$passed++
Reject {Assert-PortOutcome $true ''} 'occupied port'
Reject {Assert-PortOutcome $false ''} 'timeout remains uncertain'
Reject {Assert-PortOutcome $false 'AccessDenied'} 'denied socket'
Reject {Assert-PortOutcome $false 'NetworkUnreachable'} 'unexpected socket failure'
$text=$ast.Extent.Text
Check ($text.Contains('$task.Wait(6000)')) 'bounded six-second wait'
Check ($text.Contains("'-AdminWorker','-RunId',`$run")) 'same run passed through UAC'
Check ($text.Contains('if($rootMade -or $serviceMade -or $urlMade){Assert-PortFree}')) 'no-resource cleanup does not probe unrelated state'
Check ($text.Contains('if((Url-State).Text -cne $urlSnapshot)')) 'exact ownership snapshot retained'
$controller=[pscustomobject]@{Calls=0}
$controller|Add-Member ScriptMethod Start {$this.Calls++}
Start-OneShotCaller $controller
Check ($controller.Calls -eq 1) 'single asynchronous start request'
$denied=[pscustomobject]@{Calls=0}
$denied|Add-Member ScriptMethod Start {$this.Calls++;throw 'synthetic access denial'}
Reject {Start-OneShotCaller $denied} 'native start errors propagate'
Check ($denied.Calls -eq 1) 'failed start is not retried'
$record=[pscustomobject]@{Run='synthetic';Scm=$true;Pid=123;Result=[pscustomobject]@{ProcessIdentity='NT SERVICE\Synthetic'}}
Assert-CallerReceipt $record 'synthetic' 'NT SERVICE\Synthetic';$passed++
Reject {Assert-CallerReceipt $record 'stale' 'NT SERVICE\Synthetic'} 'stale receipt denied'
Reject {Assert-CallerReceipt $record 'synthetic' 'NT SERVICE\Other'} 'wrong identity denied'
$record.Scm=$false
Reject {Assert-CallerReceipt $record 'synthetic' 'NT SERVICE\Synthetic'} 'non-SCM receipt denied'
Check (!$text.Contains('Start-Service -Name $name')) 'no persistent-running poll for one-shot service'
"PASS: $passed pure preflight/static checks; no system operations executed"
