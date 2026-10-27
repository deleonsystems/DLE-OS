param([Parameter(Mandatory)][string]$PythonExecutable)
$ErrorActionPreference='Stop'
if(![IO.Path]::IsPathFullyQualified($PythonExecutable) -or !(Test-Path -LiteralPath $PythonExecutable -PathType Leaf)){throw 'Existing absolute Python executable required; nothing is installed by this runner'}
$priorPython=$env:DLE_OS_SIM_BOM_PYTHON
$env:DLE_OS_SIM_BOM_PYTHON=$PythonExecutable
$fixtureRoot=Join-Path $PSScriptRoot 'fixtures'
$disposable=[IO.Path]::GetFullPath((Join-Path $fixtureRoot 'disposable'))
$before=@(Get-ChildItem -LiteralPath $disposable -Directory -ErrorAction SilentlyContinue | ForEach-Object FullName)
try {
 & dotnet (Join-Path $PSScriptRoot 'qualification\IdentityChecks.dll') --fixture-root $fixtureRoot --package
 if($LASTEXITCODE -ne 0){throw 'Packaged qualification failed'}
} finally {
 $env:DLE_OS_SIM_BOM_PYTHON=$priorPython
 foreach($directory in @(Get-ChildItem -LiteralPath $disposable -Directory -ErrorAction SilentlyContinue)){
  $target=[IO.Path]::GetFullPath($directory.FullName)
  if($target.StartsWith($disposable+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase) -and $target -notin $before -and $directory.Name -match '^(auth|reference|composed|ticket-store)-[a-f0-9]{32}$'){
   Remove-Item -LiteralPath $target -Recurse -Force
  }
 }
}
