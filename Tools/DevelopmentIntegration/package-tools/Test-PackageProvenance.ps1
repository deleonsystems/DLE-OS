param([Parameter(Mandatory)][string]$Repository,[Parameter(Mandatory)][string]$Archive,[Parameter(Mandatory)][string]$ArchiveRoot,[Parameter(Mandatory)][string]$Commit,[Parameter(Mandatory)][string]$Tree,[Parameter(Mandatory)][string]$ResultPath)
$ErrorActionPreference='Stop'
Import-Module (Join-Path $PSScriptRoot 'Package-Provenance.psm1') -Force
$checks=[Collections.Generic.List[string]]::new()
function Check($ok,$name){if(!$ok){throw $name};$checks.Add($name)}
function Reject([scriptblock]$action,$name){$denied=$false;try{& $action|Out-Null}catch{$denied=$true};Check $denied $name}
$working=Get-PackageSourceIdentity -Root $Repository
Check $working.SourceDirty 'working checkout never receives clean archive provenance'
$arguments=@{Root=$ArchiveRoot;Archive=$Archive;VerificationRepository=$Repository;ExpectedCommit=$Commit;ExpectedTree=$Tree}
$clean=Get-PackageSourceIdentity @arguments
Check (!$clean.SourceDirty -and $clean.GitHead -ceq $Commit -and $clean.GitTree -ceq $Tree -and $clean.ArchiveSha256 -ceq (Get-FileHash $Archive).Hash) 'verified actual commit/tree/archive accepted'
$wrong=$arguments.Clone();$wrong.ExpectedTree='0'*40
Reject {Get-PackageSourceIdentity @wrong} 'wrong tree rejected'
$wrong=$arguments.Clone();$wrong.ExpectedCommit='0'*40
Reject {Get-PackageSourceIdentity @wrong} 'wrong commit rejected'
$parent=(& git -C $Repository rev-parse ($Commit+'^')).Trim();if($LASTEXITCODE -ne 0){throw 'Parent lookup failed'}
$parentTree=(& git -C $Repository rev-parse ($parent+'^{tree}')).Trim();if($LASTEXITCODE -ne 0){throw 'Parent tree lookup failed'}
$wrong=$arguments.Clone();$wrong.ExpectedCommit=$parent;$wrong.ExpectedTree=$parentTree
Reject {Get-PackageSourceIdentity @wrong} 'valid different commit cannot claim this archive'
$file=Join-Path $ArchiveRoot '.gitignore';$before=[IO.File]::ReadAllBytes($file)
try{[IO.File]::AppendAllText($file,"`n# altered fixture`n");Reject {Get-PackageSourceIdentity @arguments} 'modified archived source rejected'}finally{[IO.File]::WriteAllBytes($file,$before)}
$extra=Join-Path $ArchiveRoot 'uncommitted-overlay.cs'
if(Test-Path $extra){throw 'Unexpected fixture conflict'}
try{[IO.File]::WriteAllText($extra,'// synthetic overlay');Reject {Get-PackageSourceIdentity @arguments} 'uncommitted overlay cannot be labelled clean'}finally{Remove-Item -LiteralPath $extra}
$generated=Join-Path $ArchiveRoot ('generated-test-'+[Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $generated|Out-Null
try{
 [IO.File]::WriteAllText((Join-Path $generated 'result.txt'),'synthetic build output')
 $post=Get-PackageSourceIdentity @arguments -GeneratedRoots @($generated)
 Check ($post.VerifiedSourceDigest -ceq $clean.VerifiedSourceDigest) 'bounded generated output preserves archive identity'
 Reject {Get-PackageSourceIdentity @arguments -GeneratedRoots @($ArchiveRoot)} 'whole archive cannot be a generated root'
 try{[IO.File]::AppendAllText($file,"`n# changed during build`n");Reject {Get-PackageSourceIdentity @arguments -GeneratedRoots @($generated)} 'post-build archived source tampering rejected'}finally{[IO.File]::WriteAllBytes($file,$before)}
}finally{Remove-Item -LiteralPath (Join-Path $generated 'result.txt');Remove-Item -LiteralPath $generated}
$fixture=Join-Path ([IO.Path]::GetDirectoryName([IO.Path]::GetFullPath($ResultPath))) ('dependency-fixture-'+[Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path "$fixture/shared-assemblies","$fixture/staging","$fixture/cache"|Out-Null
$dll="$fixture/shared-assemblies/test.dll";$nupkg="$fixture/cache/test.nupkg";$python="$fixture/python.exe"
try{
 foreach($p in @($dll,$nupkg,$python)){[IO.File]::WriteAllText($p,'synthetic bytes, never executed')}
 @(@{Name='test.dll';Sha256=(Get-FileHash $dll).Hash})|ConvertTo-Json -AsArray|Set-Content "$fixture/shared-assemblies/manifest.json"
 @(@{Path='test.nupkg';Sha256=(Get-FileHash $nupkg).Hash})|ConvertTo-Json -AsArray|Set-Content "$fixture/staging/dependency-lock.json"
 Check (@(Assert-PackageDependencies $fixture "$fixture/cache" $python).Count -eq 3) 'pinned dependency fixtures accepted'
 [IO.File]::AppendAllText($dll,'changed');Reject {Assert-PackageDependencies $fixture "$fixture/cache" $python} 'altered shared dependency rejected'
 [IO.File]::WriteAllText($dll,'synthetic bytes, never executed');[IO.File]::AppendAllText($nupkg,'changed');Reject {Assert-PackageDependencies $fixture "$fixture/cache" $python} 'altered cached dependency rejected'
}finally{
 # Only this run's exact fixture files and now-empty directories are removed.
 foreach($p in @($dll,$nupkg,$python,"$fixture/shared-assemblies/manifest.json","$fixture/staging/dependency-lock.json")){if(Test-Path $p){Remove-Item -LiteralPath $p}}
 foreach($p in @("$fixture/shared-assemblies","$fixture/staging","$fixture/cache",$fixture)){Remove-Item -LiteralPath $p}
}
[ordered]@{Passed=$true;Count=$checks.Count;Checks=$checks;CleanIdentity=$clean;Scope='Provenance function qualification only, not a clean release of uncommitted packaging code'}|ConvertTo-Json -Depth 6|Set-Content -LiteralPath $ResultPath
"PASS $($checks.Count) provenance checks"
