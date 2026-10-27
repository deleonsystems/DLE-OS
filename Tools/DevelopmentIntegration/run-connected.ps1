param([switch]$Supporting,[Parameter(Mandatory)][string]$PythonExecutable,[Parameter(Mandatory)][string]$NuGetPackages)
$ErrorActionPreference='Stop'
$prior=Get-Location
try {
 Set-Location $PSScriptRoot
 $env:DOTNET_CLI_HOME=Join-Path $PSScriptRoot '.build-home'
 $env:DOTNET_SKIP_FIRST_TIME_EXPERIENCE='1'
 $env:DOTNET_GENERATE_ASPNET_CERTIFICATE='false'
 $env:DOTNET_ADD_GLOBAL_TOOLS_TO_PATH='false'
 $env:DOTNET_CLI_TELEMETRY_OPTOUT='1'
 $env:NUGET_PACKAGES=$NuGetPackages
 $env:DLE_TEST_REPOSITORY=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
 $env:DLE_OS_SIM_BOM_PYTHON=$PythonExecutable
 Set-Location (Join-Path $PSScriptRoot 'connected')
 & $env:DLE_OS_SIM_BOM_PYTHON make-fixtures.py
 if($LASTEXITCODE -ne 0){throw 'Fixture generation failed'}
 if($Supporting){dotnet run --project Connected.csproj --configuration Release -- --support}
 else{dotnet run --project Connected.csproj --configuration Release}
 if($LASTEXITCODE -ne 0){throw 'Connected HTTP rehearsal failed'}
 if($Supporting){return}
 Set-Location $PSScriptRoot
 foreach($suite in @(@('connected-quote-core/QuoteCore.csproj','connected-quote-results'),@('connected-estimate-core/Checks.csproj','connected-estimate-results'),@('connected-library-core/Checks.csproj','connected-library-results'))){
  $env:DLE_CHECKPOINT_RESULTS=Join-Path $PSScriptRoot $suite[1]
  dotnet run --project $suite[0] --configuration Release
  if($LASTEXITCODE -ne 0){throw "Regression failed: $($suite[0])"}
 }
 $env:DLE_CHECKPOINT_RESULTS=Join-Path $PSScriptRoot 'connected-aggregate-results'
 dotnet run --no-build --project connected-quote-core/QuoteCore.csproj --configuration Release -- --aggregate
 if($LASTEXITCODE -ne 0){throw 'Aggregate regression failed'}
} finally {Set-Location $prior}
