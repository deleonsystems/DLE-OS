param([Parameter(Mandatory)][string]$OutputDirectory,[Parameter(Mandatory)][string]$PythonExecutable,[Parameter(Mandatory)][string]$NuGetPackages,[string]$SourceArchive,[string]$VerificationRepository,[string]$ExpectedCommit,[string]$ExpectedTree)
$ErrorActionPreference='Stop'
$candidate=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$output=[IO.Path]::GetFullPath($OutputDirectory)
if(!$output.StartsWith((Join-Path $candidate 'packages')+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase) -or (Test-Path -LiteralPath $output)){throw 'Use a new package directory beneath candidate/packages'}
Import-Module (Join-Path $PSScriptRoot 'Package-Provenance.psm1') -Force
$source=Get-PackageSourceIdentity -Root ([IO.Path]::GetFullPath((Join-Path $candidate '../..'))) -Archive $SourceArchive -VerificationRepository $VerificationRepository -ExpectedCommit $ExpectedCommit -ExpectedTree $ExpectedTree
$dependencies=Assert-PackageDependencies $candidate $NuGetPackages $PythonExecutable
New-Item -ItemType Directory -Path $output | Out-Null
$env:DOTNET_CLI_HOME=Join-Path $candidate '.build-home'
$env:NUGET_PACKAGES=$NuGetPackages
foreach($dependency in (Get-Content (Join-Path $candidate 'staging\dependency-lock.json') -Raw | ConvertFrom-Json)){
 $path=Join-Path $NuGetPackages $dependency.Path
 if(!(Test-Path -LiteralPath $path) -or (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash -cne $dependency.Sha256){throw "Qualified cached package missing or changed: $($dependency.Path)"}
}
& $PythonExecutable (Join-Path $candidate 'connected\make-fixtures.py')
if($LASTEXITCODE -ne 0){throw 'Synthetic fixture generation failed'}
foreach($entry in @(@('runtime\QuotingRuntime.csproj','backend'),@('frontend-host\FrontendHost.csproj','frontend'),@('auth-tests\IdentityChecks.csproj','qualification'),@('service-tests\ServiceChecks.csproj','service-qualification'))){
 & dotnet restore (Join-Path $candidate $entry[0]) --configfile (Join-Path $candidate 'NuGet.Config')
 if($LASTEXITCODE -ne 0){throw 'Required cached dependencies unavailable'}
 & dotnet publish (Join-Path $candidate $entry[0]) -c Release --no-restore -p:EnableDefaultContentItems=false -o (Join-Path $output $entry[1])
 if($LASTEXITCODE -ne 0){throw "Publish failed: $($entry[0])"}
}
# Shared legacy security/frontend assemblies retain their SqlClient binary dependency.
# The quoting executable itself must have no SQL construction/configuration path.
$backendSource=Get-Content (Join-Path $candidate 'runtime\RuntimeApplication.cs') -Raw
if($backendSource -match 'new Sql|SecurityConnectionString|SecurityDatabase'){throw 'Unexpected backend SQL binding'}
Copy-Item -LiteralPath (Join-Path $output 'frontend\DleOs.DevelopmentFrontend.dll') -Destination (Join-Path $output 'qualification\DleOs.DevelopmentFrontend.dll') -Force
Copy-Item -LiteralPath (Join-Path $candidate 'baseline-frontend') -Destination (Join-Path $output 'frontend\frontend') -Recurse
Copy-Item -LiteralPath (Join-Path $candidate 'connected\web') -Destination (Join-Path $output 'frontend\quoting-assets') -Recurse
New-Item -ItemType Directory -Path (Join-Path $output 'fixtures\connected') -Force | Out-Null
Copy-Item -LiteralPath (Join-Path $candidate 'baseline-frontend') -Destination (Join-Path $output 'fixtures\baseline-frontend') -Recurse
Copy-Item -LiteralPath (Join-Path $candidate 'connected\web') -Destination (Join-Path $output 'fixtures\connected\web') -Recurse
Copy-Item -LiteralPath (Join-Path $candidate 'connected\fixtures') -Destination (Join-Path $output 'fixtures\connected\fixtures') -Recurse
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'Run-Qualification.ps1') -Destination $output
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'backend.template.json') -Destination (Join-Path $output 'backend')
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'frontend.template.json') -Destination (Join-Path $output 'frontend')
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'ACTIVATION_GATE.txt') -Destination $output
New-Item -ItemType Directory -Path (Join-Path $output 'staging-review') | Out-Null
Get-ChildItem -LiteralPath (Join-Path $candidate 'staging') -File | Where-Object Name -NotLike '*results.json' | Copy-Item -Destination (Join-Path $output 'staging-review')
$sourceFiles=@(foreach($folder in @('auth','auth-tests','service-tests','staging','shared-assemblies','runtime','baseline-source','frontend-host','connected','src','quote-adapter','package-tools')){
 Get-ChildItem -LiteralPath (Join-Path $candidate $folder) -File -Recurse | Where-Object {$_.FullName -notmatch '\\(bin|obj|fixtures)\\' -and $_.Name -notlike '*results.json' -and $_.Name -ne 'listener-closed.json' -and $_.Name -notlike '*.local.json' -and ($_.Extension -in @('.cs','.csproj','.js','.mjs','.css','.ps1','.psm1','.props','.sql','.md','.json','.txt'))}
})
$sourceEntries=@($sourceFiles|Sort-Object FullName|ForEach-Object{[ordered]@{Path=[IO.Path]::GetRelativePath($candidate,$_.FullName).Replace('\','/');Sha256=(Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash}})
$sourceEntries|ConvertTo-Json -Depth 4|Set-Content -LiteralPath (Join-Path $output 'source-manifest.json') -Encoding utf8
$sourceDigest=(Get-FileHash -LiteralPath (Join-Path $output 'source-manifest.json') -Algorithm SHA256).Hash
if(!$source.SourceDirty){
 $generated=@($output,(Join-Path $candidate '.build-home'),(Join-Path $candidate 'connected/fixtures'))
 foreach($project in @('auth','runtime','frontend-host','auth-tests','service-tests')){foreach($directory in @('bin','obj')){$generated+=Join-Path $candidate "$project/$directory"}}
 $after=Get-PackageSourceIdentity -Root ([IO.Path]::GetFullPath((Join-Path $candidate '../..'))) -Archive $SourceArchive -VerificationRepository $VerificationRepository -ExpectedCommit $ExpectedCommit -ExpectedTree $ExpectedTree -GeneratedRoots $generated
 if($after.VerifiedSourceDigest -cne $source.VerifiedSourceDigest){throw 'Source changed during build'}
 $null=Assert-PackageDependencies $candidate $NuGetPackages $PythonExecutable
}
$source|ConvertTo-Json -Depth 5|Set-Content -LiteralPath (Join-Path $output 'source-provenance.json') -Encoding utf8
$dependencies|ConvertTo-Json -Depth 5|Set-Content -LiteralPath (Join-Path $output 'dependency-manifest.json') -Encoding utf8
$runtimeDigest=$sourceDigest;$runtimeCount=$sourceEntries.Count
if(!$source.SourceDirty){$runtimeDigest=$source.VerifiedSourceDigest;$runtimeCount=$source.VerifiedFileCount}
$runtimeInfo=Write-PackageRuntimeMetadata $output $source $runtimeDigest $runtimeCount
if(@(Get-ChildItem -LiteralPath $output -Recurse -File|Where-Object {$_.Name -like '*results.json' -or $_.Name -eq 'listener-closed.json'}).Count){throw 'Generated result receipt leaked into package'}
# Build timestamps are truthful metadata; this manifest records exact artifacts,
# rather than claiming bit-for-bit reproducibility across builds.
$files=@(Get-ChildItem -LiteralPath $output -File -Recurse | Sort-Object FullName | ForEach-Object {
 [ordered]@{Path=[IO.Path]::GetRelativePath($output,$_.FullName).Replace('\','/');Sha256=(Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash}
})
$manifest=[ordered]@{Schema=2;SourceCheckpoint='66251559a3b062020101956971b02b0adbf05829';GitHead=$source.GitHead;GitTree=$source.GitTree;SourceMode=$source.Mode;ArchiveSha256=$source.ArchiveSha256;FrontendBaseline='20260904T230955Z';SourceDirty=$source.SourceDirty;SourceDigestSha256=$sourceDigest;ReleaseId=$runtimeInfo.ReleaseId;State='OFFLINE_NOT_DEPLOYMENT_APPROVED';Files=$files}
$manifest|ConvertTo-Json -Depth 5|Set-Content -LiteralPath (Join-Path $output 'manifest.json') -Encoding utf8
(Get-FileHash -LiteralPath (Join-Path $output 'manifest.json') -Algorithm SHA256).Hash|Set-Content -LiteralPath (Join-Path $output 'manifest.sha256')
Write-Output $output
