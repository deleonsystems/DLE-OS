param([Parameter(Mandatory)][string]$OutputDirectory,[Parameter(Mandatory)][string]$NuGetPackages)
$ErrorActionPreference='Stop'
$root=[IO.Path]::GetFullPath($PSScriptRoot)
$output=[IO.Path]::GetFullPath($OutputDirectory)
if(!$output.StartsWith($root+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase) -or (Test-Path -LiteralPath $output)){throw 'Use a new output directory within this preparation directory'}
$dependency=Join-Path $NuGetPackages 'microsoft.extensions.hosting.windowsservices/8.0.1/microsoft.extensions.hosting.windowsservices.8.0.1.nupkg'
if((Get-FileHash -LiteralPath $dependency).Hash -cne '241AD9BAFD51C6925FE7047CD60F756C4D7F25080178EB67243BC0F7CAE560A1'){throw 'Cached dependency differs; no installation or download allowed'}
$env:DOTNET_CLI_HOME=Join-Path $root '.build-home'
$env:NUGET_PACKAGES=$NuGetPackages
$env:DOTNET_GENERATE_ASPNET_CERTIFICATE='false'
& dotnet restore (Join-Path $root 'IdentityProbe.csproj') --configfile (Join-Path $root 'NuGet.Config')
if($LASTEXITCODE -ne 0){throw 'Offline restore failed'}
& dotnet publish (Join-Path $root 'IdentityProbe.csproj') -c Release --no-restore -o $output
if($LASTEXITCODE -ne 0){throw 'Build failed'}
# Deliberately never invokes the resulting executable or installs anything.
