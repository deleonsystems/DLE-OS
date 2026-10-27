$ErrorActionPreference='Stop'
function Invoke-ProvenanceGit([string]$Repository,[string[]]$Arguments){
 $info=[Diagnostics.ProcessStartInfo]::new('git');$info.UseShellExecute=$false;$info.RedirectStandardOutput=$true;$info.RedirectStandardError=$true;$info.StandardOutputEncoding=[Text.UTF8Encoding]::new($false)
 foreach($arg in (@('-C',$Repository)+$Arguments)){$info.ArgumentList.Add($arg)}
 $p=[Diagnostics.Process]::Start($info);try{$o=$p.StandardOutput.ReadToEnd();$e=$p.StandardError.ReadToEnd();$p.WaitForExit();if($p.ExitCode -ne 0){throw "Git provenance read failed: $e"};return $o.TrimEnd()}finally{$p.Dispose()}
}
function Get-PackageSourceIdentity([string]$Root,[string]$Archive,[string]$VerificationRepository,[string]$ExpectedCommit,[string]$ExpectedTree,[string[]]$GeneratedRoots=@()){
 $rootPath=[IO.Path]::GetFullPath($Root)
 if(!$Archive){
  $head=Invoke-ProvenanceGit $rootPath @('rev-parse','HEAD');$tree=Invoke-ProvenanceGit $rootPath @('rev-parse','HEAD^{tree}')
  # Only a fully verified archive can acquire clean release metadata. A working
  # checkout is conservatively dirty even when Git ignores generated inputs.
  return [pscustomobject]@{Mode='WorkingCheckout';GitHead=$head;GitTree=$tree;SourceDirty=$true;ArchiveSha256=$null;VerifiedFileCount=0;VerifiedSourceDigest=$null}
 }
 if($ExpectedCommit -notmatch '^[0-9a-f]{40}$' -or $ExpectedTree -notmatch '^[0-9a-f]{40}$' -or !$VerificationRepository){throw 'Explicit commit, tree and verification repository required'}
 $actual=Invoke-ProvenanceGit $VerificationRepository @('rev-parse',($ExpectedCommit+'^{commit}'))
 $tree=Invoke-ProvenanceGit $VerificationRepository @('rev-parse',($ExpectedCommit+'^{tree}'))
 if($actual -cne $ExpectedCommit -or $tree -cne $ExpectedTree){throw 'Commit/tree provenance mismatch'}
 $temp=Join-Path ([IO.Path]::GetTempPath()) ('quoting-archive-'+[Guid]::NewGuid().ToString('N')+'.zip')
 try{
  $null=Invoke-ProvenanceGit $VerificationRepository @('archive','--format=zip',('--output='+$temp),$ExpectedCommit)
  $sha=(Get-FileHash -LiteralPath $Archive).Hash
  if($sha -cne (Get-FileHash -LiteralPath $temp).Hash){throw 'Archive does not match the verified Git commit/tree'}
 }finally{if(Test-Path -LiteralPath $temp){Remove-Item -LiteralPath $temp}}
 $rootPrefix=$rootPath.TrimEnd('\','/')+[IO.Path]::DirectorySeparatorChar
 $generatedPrefixes=@(foreach($generatedRoot in $GeneratedRoots){
  $full=[IO.Path]::GetFullPath($generatedRoot).TrimEnd('\','/')
  if($full -ieq $rootPath.TrimEnd('\','/') -or !$full.StartsWith($rootPrefix,[StringComparison]::OrdinalIgnoreCase)){throw 'Generated root must be strictly inside source archive'}
  $full+[IO.Path]::DirectorySeparatorChar
 })
 $seen=[Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase);$lines=[Collections.Generic.List[string]]::new()
 $zip=[IO.Compression.ZipFile]::OpenRead([IO.Path]::GetFullPath($Archive))
 try{foreach($entry in ($zip.Entries|Sort-Object FullName)){
  if($entry.FullName.EndsWith('/')){continue}
  $relative=$entry.FullName
  if($relative -match '(^/|\\|:|(^|/)\.\.(/|$))' -or !$seen.Add($relative)){throw 'Unsafe/duplicate archive path'}
  $path=[IO.Path]::GetFullPath((Join-Path $rootPath $relative))
  if(!(Test-Path -LiteralPath $path -PathType Leaf)){throw "Archived input missing: $relative"}
  $item=Get-Item -LiteralPath $path
  for($checkPath=$path;$checkPath -and $checkPath.Length -ge $rootPath.Length;$checkPath=[IO.Path]::GetDirectoryName($checkPath)){if((Get-Item -LiteralPath $checkPath).Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'Linked source input forbidden'}}
  $stream=$entry.Open();try{$entrySha=[Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($stream))}finally{$stream.Dispose()}
  if($item.Length -ne $entry.Length -or (Get-FileHash -LiteralPath $path).Hash -cne $entrySha){throw "Archived input changed: $relative"}
  $lines.Add("$relative|$($entry.Length)|$entrySha")
 }}finally{$zip.Dispose()}
 # Before the build, only the separately pinned legacy assembly inputs may be
 # outside the archive. Never bless an overlaid/uncommitted packager as clean.
 $dependencies=Get-Content (Join-Path $rootPath 'Tools/DevelopmentIntegration/shared-assemblies/manifest.json') -Raw|ConvertFrom-Json
 $external=@{};foreach($d in $dependencies){$external['Tools/DevelopmentIntegration/shared-assemblies/'+$d.Name]=$d.Sha256}
 if(@(Get-ChildItem -LiteralPath $rootPath -Recurse -Force|Where-Object {$_.Attributes -band [IO.FileAttributes]::ReparsePoint}).Count){throw 'Linked archive content forbidden'}
 foreach($file in Get-ChildItem -LiteralPath $rootPath -Recurse -File -Force){
  $relative=[IO.Path]::GetRelativePath($rootPath,$file.FullName).Replace('\','/')
  if($seen.Contains($relative)){continue}
  # Used only for the post-build check, with explicit output directories from
  # the packager. Archived inputs above are always verified, even in these roots.
  $generated=$false
  foreach($prefix in $generatedPrefixes){if($file.FullName.StartsWith($prefix,[StringComparison]::OrdinalIgnoreCase)){$generated=$true}}
  if($generated){continue}
  if(!$external.ContainsKey($relative) -or (Get-FileHash -LiteralPath $file.FullName).Hash -cne $external[$relative]){throw "Unarchived input present: $relative"}
 }
 $digest=[Convert]::ToHexString([Security.Cryptography.SHA256]::HashData([Text.Encoding]::UTF8.GetBytes(($lines -join "`n"))))
 [pscustomobject]@{Mode='VerifiedGitArchive';GitHead=$actual;GitTree=$tree;SourceDirty=$false;ArchiveSha256=$sha;VerifiedFileCount=$seen.Count;VerifiedSourceDigest=$digest}
}
function Assert-PackageDependencies([string]$Candidate,[string]$NuGetPackages,[string]$PythonExecutable){
 $entries=[Collections.Generic.List[object]]::new()
 foreach($d in (Get-Content (Join-Path $Candidate 'shared-assemblies/manifest.json') -Raw|ConvertFrom-Json)){
  $file=Join-Path $Candidate ('shared-assemblies/'+$d.Name)
  if((Get-FileHash -LiteralPath $file).Hash -cne $d.Sha256){throw "Shared assembly dependency mismatch: $($d.Name)"}
  $entries.Add(@{Kind='SharedAssembly';Name=$d.Name;Sha256=$d.Sha256})
 }
 foreach($d in (Get-Content (Join-Path $Candidate 'staging/dependency-lock.json') -Raw|ConvertFrom-Json)){
  if((Get-FileHash -LiteralPath (Join-Path $NuGetPackages $d.Path)).Hash -cne $d.Sha256){throw "Cached dependency mismatch: $($d.Path)"}
  $entries.Add(@{Kind='NuGet';Name=$d.Path;Sha256=$d.Sha256})
 }
 $entries.Add(@{Kind='Python';Name=[IO.Path]::GetFileName($PythonExecutable);Sha256=(Get-FileHash -LiteralPath $PythonExecutable).Hash})
 return $entries.ToArray()
}
function Write-PackageRuntimeMetadata([string]$Output,$Source,[string]$SourceDigest,[int]$SourceCount){
 $now=[DateTimeOffset]::UtcNow;$release=$now.ToString('yyyyMMddTHHmmssZ');$frontend=Join-Path $Output 'frontend';$content=Join-Path $frontend 'frontend'
 $files=@(Get-ChildItem -LiteralPath $content -Recurse -File|Sort-Object FullName|ForEach-Object{
  $relative=[IO.Path]::GetRelativePath($content,$_.FullName).Replace('\','/')
  if($relative -ne 'DLE_Work_Center_v4.0.0.html' -and !$relative.StartsWith('SRC/') -and !$relative.StartsWith('ASSETS/')){throw 'Unexpected frontend root'}
  [ordered]@{RelativePath=$relative;Length=$_.Length;Sha256=(Get-FileHash -LiteralPath $_.FullName).Hash}
 })
 $manifest=[ordered]@{SchemaVersion=1;ReleaseId=$release;GitHead=$Source.GitHead;FileCount=$files.Count;Files=$files}
 $manifest|ConvertTo-Json -Depth 6|Set-Content -LiteralPath (Join-Path $frontend 'frontend-manifest.json') -Encoding utf8
 $info=[ordered]@{SchemaVersion=2;Environment='Development';ReleaseId=$release;BuiltAtUtc=$now.ToString('o');GitHead=$Source.GitHead;SourceDirty=[bool]$Source.SourceDirty;SourceDigestSha256=$SourceDigest;SourceFileCount=$SourceCount;FrontendManifestSha256=(Get-FileHash -LiteralPath (Join-Path $frontend 'frontend-manifest.json')).Hash;FrontendFileCount=$files.Count;FrontendContentRootIdentity='release/frontend';ServiceName='DleOsDevelopmentFrontend';ServiceIdentity='DLE-OS-HOST\DLE-OS-DEV-FRONTEND'}
 $info|ConvertTo-Json -Depth 4|Set-Content -LiteralPath (Join-Path $frontend 'runtime-build-info.json') -Encoding utf8
 return $info
}
Export-ModuleMember -Function Get-PackageSourceIdentity,Assert-PackageDependencies,Write-PackageRuntimeMetadata
