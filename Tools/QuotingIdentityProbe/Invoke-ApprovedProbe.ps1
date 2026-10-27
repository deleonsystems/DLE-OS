#requires -Version 7.0
param([switch]$AdminWorker)
$ErrorActionPreference='Stop'
$prep='C:\Users\Miguel\Documents\Codex\2026-10-26\task\scm-identity-probe-preparation'
$manifestPath=Join-Path $prep 'qualified-manifest.json'
$manifestHash='790D097EA012A918A8AC8A8AFC7CA776C0EA180B04B733CBCF0FDF39B731961E'
$name='DleOsQuotingIdentityProbe'
$identity='NT SERVICE\DleOsQuotingIdentityProbe'
$operator='DLE-OS-HOST\Miguel'
$run='d797b134-9d4f-4bef-a291-3973f97a1f5f'
$prefix='http://127.0.0.1:51328/quoting-identity-probe/'
$root='C:\ProgramData\DLE-OS\QuotingIdentityProbe'
$release=Join-Path $root 'release\probe-20261027-v1'
$runRoot=Join-Path $root "runs\$run"
$receipt=Join-Path $prep "receipts\$run"
$exe=Join-Path $release 'QuotingIdentityProbe.exe'
$bin='"'+$exe+'" --service '+$run
$principal=[Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent())
$admin=$principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if([Security.Principal.WindowsIdentity]::GetCurrent().Name -ine $operator){throw 'Run only from Miguel on HOST'}
if($env:COMPUTERNAME -ine 'DLE-OS-HOST'){throw 'Wrong machine'}
if((Get-FileHash -LiteralPath $manifestPath).Hash -cne $manifestHash){throw 'Approved manifest mismatch'}
$manifest=Get-Content -LiteralPath $manifestPath -Raw|ConvertFrom-Json
foreach($f in $manifest.Files){
 if($f.Path -match '(^[\\/]|\.\.|:)'){throw 'Unsafe manifest path'}
 if((Get-FileHash -LiteralPath (Join-Path "$prep\qualified-package" $f.Path)).Hash -cne $f.Sha256){throw 'Package differs from approval'}
}
function Record($file,$value){
 $path=Join-Path $receipt $file
 $stream=[IO.File]::Open($path,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::Read)
 try{$bytes=[Text.Encoding]::UTF8.GetBytes(($value|ConvertTo-Json -Depth 12));$stream.Write($bytes)}finally{$stream.Dispose()}
}
function Wait-File($path,[int]$seconds){
 $until=[DateTimeOffset]::UtcNow.AddSeconds($seconds)
 while(!(Test-Path -LiteralPath $path)){
  if([DateTimeOffset]::UtcNow -gt $until){throw "Timed out waiting for $path"}
  if((Test-Path -LiteralPath "$receipt\worker-final.json") -and $path -ne "$receipt\worker-final.json"){throw 'Administrator worker ended; inspect worker-final.json'}
  Start-Sleep -Milliseconds 250
 }
}
function Assert-NoLinks($path){
 $p=[IO.Path]::GetFullPath($path)
 while($p){if(Test-Path -LiteralPath $p){if((Get-Item -LiteralPath $p -Force).Attributes -band [IO.FileAttributes]::ReparsePoint){throw "Linked path is not allowed: $p"}};$p=[IO.Path]::GetDirectoryName($p)}
}
function Assert-PortFree {
 $tcp=[Net.Sockets.TcpClient]::new()
 try{
  $task=$tcp.ConnectAsync('127.0.0.1',51328)
  try{$done=$task.Wait(1000)}catch{
   $e=$_.Exception;while($e.InnerException){$e=$e.InnerException}
   if($e -is [Net.Sockets.SocketException] -and $e.SocketErrorCode -eq [Net.Sockets.SocketError]::ConnectionRefused){return}
   throw
  }
  if(!$done){throw 'Port availability is uncertain'}
  throw 'Port 51328 is occupied'
 }finally{$tcp.Dispose()}
}
function Url-State {
 $output=(& netsh.exe http show urlacl "url=$prefix" 2>&1|Out-String).Trim();$code=$LASTEXITCODE
 if($output -match [regex]::Escape($prefix)){return @{Exists=$true;Text=$output;Exit=$code}}
 if($output -match '(?i)Error\s*:\s*2\b|cannot find the file'){return @{Exists=$false;Text=$output;Exit=$code}}
 throw "Unrecognized URL reservation result; no change made: $output"
}
function Definition {
 $key="HKLM:\SYSTEM\CurrentControlSet\Services\$name"
 if(!(Test-Path -LiteralPath $key)){return $null}
 $s=Get-ItemProperty -LiteralPath $key
 if($s.ImagePath -cne $bin -or $s.ObjectName -ine $identity -or $s.Start -ne 3){throw 'Service definition differs; refusing to touch it'}
 return @{ImagePath=$s.ImagePath;ObjectName=$s.ObjectName;Start=$s.Start}
}
function Live-State {
 try{
  $o=Invoke-RestMethod 'http://dle-os-host:5052/api/platform/live/v1/readiness' -TimeoutSec 10
  $i=Invoke-RestMethod 'http://dle-os-host:5052/api/platform/live/v1/invoice-history/metadata' -TimeoutSec 10
  return @{Operations=$o.currentImportRunId;Readiness=$o.readinessState;Invoice=$i.invoiceHistoryImportRunId;Headers=$i.customerInvoiceCount;Lines=$i.customerInvoiceLineCount}
 }catch{return @{Error=$_.Exception.Message}}
}
if(!$AdminWorker){
 if($admin){throw 'Start this launcher in a NORMAL Miguel PowerShell window; it requests UAC once itself'}
 Assert-NoLinks $receipt
 if(Test-Path -LiteralPath $receipt){throw 'This run already has receipts; do not repeat it'}
 New-Item -ItemType Directory -Path $receipt|Out-Null
 Record 'launcher.json' @{At=[DateTimeOffset]::UtcNow;Identity=$operator;Manifest=$manifestHash;ScriptHash=(Get-FileHash $PSCommandPath).Hash}
 $observer=$null;$worker=$null;$failure=$null
 try{
  $shell=(Get-Process -Id $PID).Path
  $worker=Start-Process -FilePath $shell -ArgumentList @('-NoProfile','-File',('"'+$PSCommandPath+'"'),'-AdminWorker') -Verb RunAs -WindowStyle Hidden -PassThru
  Wait-File "$receipt\ready.json" 60
  $observer=Start-Process -FilePath $exe -ArgumentList @('--observer',$run) -WindowStyle Hidden -PassThru
  Wait-File "$runRoot\observer\started.json" 15
  Wait-File "$receipt\caller-done.json" 35
  $negative=Start-Process -FilePath $exe -ArgumentList @('--negative',$run) -WindowStyle Hidden -PassThru
  if(!$negative.WaitForExit(30000)){throw 'Negative controls did not finish; no forced termination'}
  if($negative.ExitCode -ne 0){throw 'Negative controls failed; inspect receipts'}
 }catch{$failure=$_.Exception.Message}
 finally{
  if($observer -and !$observer.HasExited){[void]$observer.WaitForExit(100000)}
  Record 'launcher-done.json' @{At=[DateTimeOffset]::UtcNow;Failure=$failure;ObserverExited=(!$observer -or $observer.HasExited)}
 }
 if(!$worker){Write-Host "Administrator launch did not occur: $failure"; return}
 Wait-File "$receipt\worker-final.json" 80
 Get-Content -LiteralPath "$receipt\worker-final.json"
 Write-Host "Retained receipts: $receipt"
 return
}
if(!$admin){throw 'Administrator worker needs the UAC-approved administrator token'}
if(!(Test-Path -LiteralPath "$receipt\launcher.json")){throw 'Use the normal launcher'}
Record 'worker-start.json' @{At=[DateTimeOffset]::UtcNow;Identity=$operator;Administrator=$true}
$rootMade=$false;$serviceMade=$false;$urlMade=$false;$uncertain=$false;$urlSnapshot=$null;$failure=$null;$cleanup=@();$before=Live-State
try{
 Assert-NoLinks $root
 if(Test-Path -LiteralPath $root){throw 'Probe root exists; unknown files will not be reused'}
 $query=(& sc.exe query $name 2>&1|Out-String);if($LASTEXITCODE -ne 1060){throw 'Service is present or its absence cannot be established'}
 if((Url-State).Exists){throw 'URL reservation exists'}
 Assert-PortFree
 Record 'preflight.json' @{At=[DateTimeOffset]::UtcNow;ServiceAbsent=$true;RootAbsent=$true;UrlAbsent=$true;PortRefused=$true;Live=$before}
 New-Item -ItemType Directory -Path $root|Out-Null;$rootMade=$true
 $acl=[Security.AccessControl.DirectorySecurity]::new();$acl.SetAccessRuleProtection($true,$false)
 foreach($rule in @(@('S-1-5-18','FullControl'),@('S-1-5-32-544','FullControl'),@(([Security.Principal.NTAccount]::new($operator).Translate([Security.Principal.SecurityIdentifier]).Value),'ReadAndExecute'))){
  $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new([Security.Principal.SecurityIdentifier]::new($rule[0]),[Security.AccessControl.FileSystemRights]$rule[1],'ContainerInherit,ObjectInherit','None','Allow'))
 }
 Set-Acl -LiteralPath $root -AclObject $acl
 New-Item -ItemType Directory -Path $release,"$runRoot\caller","$runRoot\observer"|Out-Null
 foreach($f in $manifest.Files){$to=Join-Path $release $f.Path;New-Item -ItemType Directory -Path (Split-Path $to) -Force|Out-Null;Copy-Item -LiteralPath (Join-Path "$prep\qualified-package" $f.Path) -Destination $to;if((Get-FileHash $to).Hash -cne $f.Sha256){throw 'Staged file mismatch'}}
 $uncertain=$true;$created=(& sc.exe create $name "binPath=$bin" start= demand "obj=$identity" 2>&1|Out-String);if($LASTEXITCODE -ne 0){throw "Service creation failed or uncertain: $created"};$serviceMade=$true;$uncertain=$false
 $definition=Definition
 $sid=[Security.Principal.NTAccount]::new($identity).Translate([Security.Principal.SecurityIdentifier])
 $acl=Get-Acl -LiteralPath $root;$acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($sid,'ReadAndExecute','ContainerInherit,ObjectInherit','None','Allow'));Set-Acl -LiteralPath $root -AclObject $acl
 foreach($item in @(@("$runRoot\caller",$identity),@("$runRoot\observer",$operator))){$a=Get-Acl -LiteralPath $item[0];$a.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($item[1],'Modify','ContainerInherit,ObjectInherit','None','Allow'));Set-Acl -LiteralPath $item[0] -AclObject $a}
 Record 'service-created.json' @{At=[DateTimeOffset]::UtcNow;Definition=$definition;Sid=$sid.Value;RootSddl=(Get-Acl $root).Sddl;CallerSddl=(Get-Acl "$runRoot\caller").Sddl;ObserverSddl=(Get-Acl "$runRoot\observer").Sddl}
 $uncertain=$true;$added=(& netsh.exe http add urlacl "url=$prefix" "user=$operator" listen=yes delegate=no 2>&1|Out-String);if($LASTEXITCODE -ne 0){throw "URL reservation failed or uncertain: $added"};$urlMade=$true;$uncertain=$false;$urlSnapshot=(Url-State).Text
 Record 'ready.json' @{At=[DateTimeOffset]::UtcNow;Url=$urlSnapshot;Release=$release;Manifest=$manifestHash}
 Wait-File "$runRoot\observer\started.json" 35
 $observed=Get-Content "$runRoot\observer\started.json" -Raw|ConvertFrom-Json
 if($observed.Identity -ine $operator -or $observed.Run -ne $run){throw 'Observer receipt mismatch'}
 $process=Get-Process -Id $observed.Pid;if($process.Path -ine $exe){throw 'Observer executable mismatch'}
 $null=Definition;Start-Service -Name $name
 Wait-File "$runRoot\caller\result.json" 25
 Record 'caller-done.json' @{At=[DateTimeOffset]::UtcNow;Result=(Get-Content "$runRoot\caller\result.json" -Raw|ConvertFrom-Json)}
 Wait-File "$receipt\launcher-done.json" 120
}catch{$failure=$_.Exception.Message}
finally{
 try{
  if($uncertain){throw "A mutation outcome is uncertain; retain resources for inspection without retry"}
  if($serviceMade){$null=Definition;$s=Get-Service $name;if($s.Status -ne 'Stopped'){Stop-Service $name;$s.WaitForStatus('Stopped',[TimeSpan]::FromSeconds(15))};$s.Dispose();$s=$null;$cleanup+='Service stopped'}
  if(Test-Path "$runRoot\observer\started.json"){$o=Get-Content "$runRoot\observer\started.json" -Raw|ConvertFrom-Json;$p=Get-Process -Id $o.Pid -ErrorAction SilentlyContinue;if($p){if($p.Path -ine $exe){throw 'Observer PID reused; refusing cleanup'};if(!$p.WaitForExit(100000)){throw 'Observer still active; no forced termination'}}}
  Assert-PortFree
  if($uncertain){throw "A mutation outcome is uncertain; retain resources for inspection without retry"}
  if($serviceMade){$null=Definition;$deleted=(& sc.exe delete $name 2>&1|Out-String);if($LASTEXITCODE -ne 0){throw "Service removal uncertain: $deleted"};$s=$null;$query=(& sc.exe query $name 2>&1|Out-String);if($LASTEXITCODE -ne 1060){throw 'Service removal not yet verified'};$cleanup+='Service absent'}
  if($urlMade){if((Url-State).Text -cne $urlSnapshot){throw 'URL reservation changed; refusing removal'};$deleted=(& netsh.exe http delete urlacl "url=$prefix" 2>&1|Out-String);if($LASTEXITCODE -ne 0 -or (Url-State).Exists){throw 'URL removal not verified'};$cleanup+='URL absent'}
  if($rootMade){
   Assert-NoLinks $root;$items=@(Get-ChildItem -LiteralPath $root -Recurse -Force);if(@($items|Where-Object {$_.Attributes -band [IO.FileAttributes]::ReparsePoint}).Count){throw 'Linked item found; retaining files'}
   $allowed=@($manifest.Files|ForEach-Object{Join-Path $release $_.Path})+@("$runRoot\caller\result.json","$runRoot\observer\started.json","$runRoot\observer\stopped.json","$runRoot\observer\negative.json")+@(1..6|ForEach-Object{"$runRoot\observer\request-$_.json"})
   $files=@($items|Where-Object {!$_.PSIsContainer});if(@($files|Where-Object {$_.FullName -notin $allowed}).Count){throw 'Unknown staged file; retaining root'}
   foreach($f in $files){$target=Join-Path "$receipt\retained" ([IO.Path]::GetRelativePath($root,$f.FullName));New-Item -ItemType Directory -Path (Split-Path $target) -Force|Out-Null;Copy-Item -LiteralPath $f.FullName -Destination $target;if((Get-FileHash $target).Hash -cne (Get-FileHash $f.FullName).Hash){throw 'Receipt copy mismatch'}}
   foreach($f in $files){Remove-Item -LiteralPath $f.FullName -Force}
   foreach($d in ($items|Where-Object PSIsContainer|Sort-Object {$_.FullName.Length} -Descending)){Remove-Item -LiteralPath $d.FullName}
   Remove-Item -LiteralPath $root;$cleanup+='Known staged files removed; evidence retained'
  }
 }catch{$cleanup+='BLOCKED: '+$_.Exception.Message}
 Record 'worker-final.json' @{At=[DateTimeOffset]::UtcNow;Failure=$failure;Cleanup=$cleanup;LiveBefore=$before;LiveAfter=(Live-State);Receipt=$receipt;NoAutomaticRetry=$true}
}
