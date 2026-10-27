param([Parameter(Mandatory)][string]$OutputDirectory,[Parameter(Mandatory)][string]$PythonExecutable,[Parameter(Mandatory)][string]$NuGetPackages)
$ErrorActionPreference='Stop'
$candidate=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$output=[IO.Path]::GetFullPath($OutputDirectory)
if(!$output.StartsWith((Join-Path $candidate 'packages')+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase) -or (Test-Path -LiteralPath $output)){throw 'Use a new package directory beneath candidate/packages'}
New-Item -ItemType Directory -Path $output | Out-Null
$env:DOTNET_CLI_HOME=Join-Path $candidate '.build-home'
$env:NUGET_PACKAGES=$NuGetPackages
& $PythonExecutable (Join-Path $candidate 'connected\make-fixtures.py')
if($LASTEXITCODE -ne 0){throw 'Synthetic fixture generation failed'}
foreach($entry in @(@('runtime\QuotingRuntime.csproj','backend'),@('frontend-host\FrontendHost.csproj','frontend'),@('auth-tests\IdentityChecks.csproj','qualification'))){
 & dotnet restore (Join-Path $candidate $entry[0]) --configfile (Join-Path $candidate 'NuGet.Config')
 if($LASTEXITCODE -ne 0){throw 'Required cached dependencies unavailable'}
 & dotnet publish (Join-Path $candidate $entry[0]) -c Release --no-restore -o (Join-Path $output $entry[1])
 if($LASTEXITCODE -ne 0){throw "Publish failed: $($entry[0])"}
}
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
$sourceFiles=@(foreach($folder in @('auth','auth-tests','runtime','baseline-source','frontend-host','connected','src','quote-adapter','package-tools')){
 Get-ChildItem -LiteralPath (Join-Path $candidate $folder) -File -Recurse | Where-Object {$_.FullName -notmatch '\\(bin|obj|fixtures)\\' -and ($_.Extension -in @('.cs','.csproj','.js','.mjs','.css','.ps1','.props') -or $_.Name -eq 'roles.json')}
})
$sourceEntries=@($sourceFiles|Sort-Object FullName|ForEach-Object{[ordered]@{Path=[IO.Path]::GetRelativePath($candidate,$_.FullName).Replace('\','/');Sha256=(Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash}})
$sourceEntries|ConvertTo-Json -Depth 4|Set-Content -LiteralPath (Join-Path $output 'source-manifest.json') -Encoding utf8
$sourceDigest=(Get-FileHash -LiteralPath (Join-Path $output 'source-manifest.json') -Algorithm SHA256).Hash
# No timestamps, absolute package path or random run identifiers in the manifest.
$files=@(Get-ChildItem -LiteralPath $output -File -Recurse | Sort-Object FullName | ForEach-Object {
 [ordered]@{Path=[IO.Path]::GetRelativePath($output,$_.FullName).Replace('\','/');Sha256=(Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash}
})
$manifest=[ordered]@{Schema=1;SourceCheckpoint='66251559a3b062020101956971b02b0adbf05829';FrontendBaseline='20260904T230955Z';SourceDirty=$true;SourceDigestSha256=$sourceDigest;State='OFFLINE_NOT_DEPLOYMENT_APPROVED';Files=$files}
$manifest|ConvertTo-Json -Depth 5|Set-Content -LiteralPath (Join-Path $output 'manifest.json') -Encoding utf8
(Get-FileHash -LiteralPath (Join-Path $output 'manifest.json') -Algorithm SHA256).Hash|Set-Content -LiteralPath (Join-Path $output 'manifest.sha256')
Write-Output $output
